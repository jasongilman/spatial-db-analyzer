"""DuckDB's `spatial` extension, which is GEOS underneath and planar like Shapely.

It is included separately from Shapely because it is what someone reaches for
when the data is already in a database, and because it exposes a different
surface: validity is a bare boolean, there is no reason string, and geometry
arrives as GeoJSON text through a query parameter.
"""

import hashlib
import json
from typing import Any, cast

import duckdb
import numpy as np
from numpy.typing import NDArray

from spatial_db_analyzer.models import BBox, SystemInfo, TestPolygon, Variant
from spatial_db_analyzer.systems.base import SystemEvaluation
from spatial_db_analyzer.workarounds import densify, fix_antimeridian

RAW = Variant(
    id="raw",
    name="Raw input",
    description="The polygon as-is, with no preprocessing.",
    tradeoffs=("Nothing to remember, but geodetic cases are wrong.",),
    how_it_helps=(
        "It doesn't. The polygon goes in untouched, so this column shows the library's "
        "limitations exactly as they are."
    ),
    workaround_ids=(),
)

ANTIMERIDIAN_FIX = Variant(
    id="antimeridian_fix",
    name="Antimeridian fix",
    description=(
        "Preprocessed with the `antimeridian` package before insertion, with `fix_winding=False` "
        "so the ring's orientation is left alone."
    ),
    tradeoffs=(
        "Splits into a MultiPolygon at +/-180, so the stored shape no longer matches the input.",
        (
            "Closes pole coverage with edges along +/-90 latitude, which is an artifact of the "
            "projection, not real geometry."
        ),
        "The caller has to know to do this.",
    ),
    how_it_helps=(
        "Addresses the antimeridian and the poles. A ring that crosses +/-180 is split there, so "
        "the library reads it the short way around, and a ring around a pole is closed along "
        "+/-90 latitude, so it encloses the cap. Edges stay straight, so a polygon with long "
        "edges, such as `wide`, is still wrong."
    ),
    workaround_ids=("antimeridian",),
)

GRID_DIGEST_BYTES = 16
"""Digest width for the grid fingerprint. Collisions here would reuse the wrong table."""


def _grid_fingerprint(lons: NDArray[np.float64], lats: NDArray[np.float64]) -> str:
    """Fingerprint a grid by its coordinates.

    Args:
        lons: Grid longitudes in degrees.
        lats: Grid latitudes in degrees.

    Returns:
        A hex digest that changes whenever any coordinate does.
    """
    digest = hashlib.blake2b(digest_size=GRID_DIGEST_BYTES)
    digest.update(np.ascontiguousarray(lons).tobytes())
    digest.update(np.ascontiguousarray(lats).tobytes())
    return digest.hexdigest()


DENSIFIED_FIX = Variant(
    id="densified_fix",
    name="Densified, then fixed",
    description=(
        "A vertex added every 1 degree along each great-circle edge, then the antimeridian fix."
    ),
    tradeoffs=(
        "Straight segments only approximate the curve; error grows with segment length.",
        "Far more vertices to store and test.",
        "Still wrong if you forget it.",
    ),
    how_it_helps=(
        "Addresses all three edge problems. Densifying replaces each long straight edge with "
        "1-degree steps along its great circle, so the library's straight lines hug the true arc. "
        "The antimeridian fix then handles +/-180 and the poles. It can't help `both_poles`, "
        "whose interior is chosen by winding order, which a planar library ignores."
    ),
    workaround_ids=("densify", "antimeridian"),
)


class DuckDbSpatialSystem:
    """Adapter for DuckDB with the `spatial` extension.

    Holds one connection, with the grid loaded into a table once, so each
    polygon costs a single containment query. The instance outlives a single
    run, so the table is keyed on the grid's coordinates rather than its
    length: two different grids of the same size must not share a table.
    """

    info = SystemInfo(
        id="duckdb_spatial",
        name="DuckDB `spatial`",
        version=duckdb.__version__,
        semantics="planar",
        notes=(
            "DuckDB's `spatial` extension, which wraps GEOS and so has the same planar semantics "
            "as Shapely: coordinates are x and y on a flat plane. DuckDB also ships a separate "
            "`geography` extension built on S2, which is spherical; that one is not part of this "
            "phase."
        ),
        limitations=(
            (
                "Edges are straight lines in longitude and latitude, not great-circle arcs, so a "
                "long edge cuts across the true boundary."
            ),
            (
                "Longitude doesn't wrap. A ring that crosses +/-180 is read as running the long "
                "way around the map."
            ),
            (
                "There are no poles. A ring around a pole encloses nothing on a flat plane, so the "
                "polygon is invalid or covers the wrong area."
            ),
            (
                "Winding order doesn't choose the interior. A ring always bounds the region inside "
                "it on the plane, so a polygon meant as everything outside the ring can't be "
                "expressed."
            ),
        ),
        docs_url="https://duckdb.org/docs/stable/core_extensions/spatial/overview",
    )

    variants = (RAW, ANTIMERIDIAN_FIX, DENSIFIED_FIX)

    def __init__(self) -> None:
        self._connection: duckdb.DuckDBPyConnection | None = None
        self._grid_key: str | None = None

    def _connect(self) -> duckdb.DuckDBPyConnection:
        """Open the connection and load the extension, once per run."""
        if self._connection is None:
            connection = duckdb.connect()
            connection.execute("INSTALL spatial; LOAD spatial;")
            self._connection = connection
        return self._connection

    def _load_points(
        self, lons: NDArray[np.float64], lats: NDArray[np.float64]
    ) -> duckdb.DuckDBPyConnection:
        """Create the points table, reusing it when the grid has not changed."""
        connection = self._connect()
        key = _grid_fingerprint(lons, lats)
        if self._grid_key == key:
            return connection

        connection.execute("DROP TABLE IF EXISTS points")
        connection.execute("CREATE TABLE points (id INTEGER, lon DOUBLE, lat DOUBLE)")
        rows = [
            (index, float(lon), float(lat))
            for index, (lon, lat) in enumerate(zip(lons, lats, strict=True))
        ]
        # An empty grid is a legitimate run: a region with no points in it. DuckDB
        # rejects executemany with no parameter sets, so the table just stays empty.
        if rows:
            connection.executemany("INSERT INTO points VALUES (?, ?, ?)", rows)
        self._grid_key = key
        return connection

    def evaluate(
        self,
        polygon: TestPolygon,
        lons: NDArray[np.float64],
        lats: NDArray[np.float64],
        variant_id: str,
    ) -> SystemEvaluation:
        """Run one polygon through DuckDB under one variant.

        Args:
            polygon: The polygon to test.
            lons: Grid longitudes in degrees.
            lats: Grid latitudes in degrees.
            variant_id: Which variant to apply.

        Returns:
            What DuckDB reported.

        Raises:
            ValueError: If the variant id is not one of this system's.
        """
        match variant_id:
            case "raw":
                submitted = polygon.polygon
            case "antimeridian_fix":
                submitted = fix_antimeridian(polygon.polygon, fix_winding=False)
            case "densified_fix":
                submitted = fix_antimeridian(densify(polygon.polygon), fix_winding=False)
            case _:
                raise ValueError(f"Unknown duckdb_spatial variant: {variant_id}")

        geojson = json.dumps(submitted.model_dump())
        connection = self._load_points(lons, lats)

        # ST_IsValid returns a bare boolean; the spatial extension has no
        # ST_IsValidReason, so an invalid polygon has no message to record.
        valid_row = cast(
            "tuple[bool] | None",
            connection.execute("SELECT ST_IsValid(ST_GeomFromGeoJSON(?))", [geojson]).fetchone(),
        )
        valid = valid_row is not None and bool(valid_row[0])
        validation_errors = () if valid else ("ST_IsValid returned false (no reason available)",)

        inside_rows = cast(
            "list[tuple[int]]",
            connection.execute(
                "SELECT id FROM points "
                "WHERE ST_Contains(ST_GeomFromGeoJSON(?), ST_Point(lon, lat)) "
                "ORDER BY id",
                [geojson],
            ).fetchall(),
        )
        inside = [False] * len(lons)
        for (index,) in inside_rows:
            inside[index] = True

        extent_row = cast(
            "tuple[dict[str, Any] | None] | None",
            connection.execute("SELECT ST_Extent(ST_GeomFromGeoJSON(?))", [geojson]).fetchone(),
        )
        bbox = None
        if extent_row is not None and extent_row[0] is not None:
            # ST_Extent returns a BOX_2D, which arrives in Python as a dict.
            extent = extent_row[0]
            bbox = BBox(
                west=float(cast("float", extent["min_x"])),
                south=float(cast("float", extent["min_y"])),
                east=float(cast("float", extent["max_x"])),
                north=float(cast("float", extent["max_y"])),
            )

        return SystemEvaluation(
            accepted=True,
            validation_errors=validation_errors,
            submitted_geometry=submitted,
            contains=tuple(inside),
            # ST_Area reports square degrees, which is not comparable to an area
            # on a sphere.
            area_m2=None,
            bbox=bbox,
        )
