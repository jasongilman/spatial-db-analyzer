"""DuckDB's `spatial` extension, which is GEOS underneath and planar like Shapely.

It is included separately from Shapely because it is what someone reaches for
when the data is already in a database, and because it exposes a different
surface: validity is a bare boolean, there is no reason string, and geometry
arrives as GeoJSON text through a query parameter.
"""

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
)

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
)


class DuckDbSpatialSystem:
    """Adapter for DuckDB with the `spatial` extension.

    Holds one connection for the whole run, with the grid loaded into a table
    once, so each polygon costs a single containment query.
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
    )

    variants = (RAW, ANTIMERIDIAN_FIX, DENSIFIED_FIX)

    def __init__(self) -> None:
        self._connection: duckdb.DuckDBPyConnection | None = None
        self._grid_size: int | None = None

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
        if self._grid_size == len(lons):
            return connection

        connection.execute("DROP TABLE IF EXISTS points")
        connection.execute("CREATE TABLE points (id INTEGER, lon DOUBLE, lat DOUBLE)")
        rows = [
            (index, float(lon), float(lat))
            for index, (lon, lat) in enumerate(zip(lons, lats, strict=True))
        ]
        connection.executemany("INSERT INTO points VALUES (?, ?, ?)", rows)
        self._grid_size = len(lons)
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
