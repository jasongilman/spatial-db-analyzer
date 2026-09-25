"""Shapely, a planar geometry engine, run against geodetic polygons.

Shapely is not buggy here: it does exactly what a planar library should, which
is to treat longitude and latitude as x and y on a flat plane. Including it
shows what that costs when the data is actually on a sphere.
"""

import numpy as np
import shapely
from numpy.typing import NDArray

from spatial_db_analyzer.models import BBox, SystemInfo, TestPolygon, Variant
from spatial_db_analyzer.systems.base import SystemEvaluation
from spatial_db_analyzer.workarounds import densify, fix_antimeridian, to_shapely

VALID_GEOMETRY_REASON = "Valid Geometry"
"""What ``shapely.is_valid_reason`` returns when it finds nothing wrong."""

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

ANTIMERIDIAN_FIX_REWOUND = Variant(
    id="antimeridian_fix_rewound",
    name="Antimeridian fix, rewound",
    description="The same antimeridian fix, left at the package's default `fix_winding=True`.",
    tradeoffs=(
        (
            "Rewinding reinterprets which side of the ring is the interior, so `both_poles` "
            "collapses from 88% of the globe to the 12% box."
        ),
        "This is the library's default, so it is what you get if you never think about winding.",
    ),
    how_it_helps=(
        "The same split and pole closing as the antimeridian fix. The package also rewinds each "
        "ring to the orientation a planar library expects, which doesn't change what a planar "
        "library reads but does throw away the only record of which side was meant to be inside."
    ),
    workaround_ids=("antimeridian",),
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
    how_it_helps=(
        "Addresses all three edge problems. Densifying replaces each long straight edge with "
        "1-degree steps along its great circle, so the library's straight lines hug the true arc. "
        "The antimeridian fix then handles +/-180 and the poles. It can't help `both_poles`, "
        "whose interior is chosen by winding order, which a planar library ignores."
    ),
    workaround_ids=("densify", "antimeridian"),
)


class ShapelySystem:
    """Adapter for Shapely (GEOS)."""

    info = SystemInfo(
        id="shapely",
        name="Shapely (GEOS)",
        version=shapely.__version__,
        semantics="planar",
        notes=(
            "A planar geometry engine: longitude and latitude are treated as x and y on a flat "
            "plane, with straight edges between vertices. It has no notion of a sphere, so it "
            "cannot represent a great-circle edge, the antimeridian wrapping around, or a "
            "polygon that contains a pole."
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
                " `orient()` fixes winding by planar signed area, which can disagree with the "
                "geodetic intent."
            ),
        ),
        docs_url="https://shapely.readthedocs.io/",
    )

    variants = (RAW, ANTIMERIDIAN_FIX, ANTIMERIDIAN_FIX_REWOUND, DENSIFIED_FIX)

    def evaluate(
        self,
        polygon: TestPolygon,
        lons: NDArray[np.float64],
        lats: NDArray[np.float64],
        variant_id: str,
    ) -> SystemEvaluation:
        """Run one polygon through Shapely under one variant.

        Args:
            polygon: The polygon to test.
            lons: Grid longitudes in degrees.
            lats: Grid latitudes in degrees.
            variant_id: Which variant to apply.

        Returns:
            What Shapely reported.

        Raises:
            ValueError: If the variant id is not one of this system's.
        """
        match variant_id:
            case "raw":
                submitted = polygon.polygon
            case "antimeridian_fix":
                submitted = fix_antimeridian(polygon.polygon, fix_winding=False)
            case "antimeridian_fix_rewound":
                submitted = fix_antimeridian(polygon.polygon, fix_winding=True)
            case "densified_fix":
                submitted = fix_antimeridian(densify(polygon.polygon), fix_winding=False)
            case _:
                raise ValueError(f"Unknown shapely variant: {variant_id}")

        geometry = to_shapely(submitted)

        reason = shapely.is_valid_reason(geometry)
        validation_errors = () if reason == VALID_GEOMETRY_REASON else (reason,)

        inside = shapely.contains_xy(geometry, lons, lats)
        min_x, min_y, max_x, max_y = geometry.bounds

        return SystemEvaluation(
            accepted=True,
            validation_errors=validation_errors,
            submitted_geometry=submitted,
            contains=tuple(bool(value) for value in inside),
            # Shapely reports area in square degrees, which is not comparable to
            # an area on a sphere, so there is nothing meaningful to record.
            area_m2=None,
            bbox=BBox(west=min_x, south=min_y, east=max_x, north=max_y),
        )
