"""spherely, a spherical geometry library built on S2.

spherely models the Earth as a sphere with great-circle edges, so it is the
closest comparison to the reference implementation, and it is used to
cross-check the reference in tests. Its two variants exist because of how it
handles winding order, which is the single most consequential option in the
whole project.
"""

from typing import Any, cast

import numpy as np
import spherely
from numpy.typing import NDArray

from spatial_db_analyzer.models import SystemInfo, TestPolygon, Variant
from spatial_db_analyzer.spherical import EARTH_RADIUS_M
from spatial_db_analyzer.systems.base import SystemEvaluation

DEFAULT = Variant(
    id="default",
    name="Default",
    description="spherely's default, which ignores winding order.",
    tradeoffs=(
        "Always assumes the smaller of the two candidate polygons.",
        "Cannot represent a polygon larger than a hemisphere.",
    ),
    how_it_helps=(
        "No preprocessing is needed for edges, the antimeridian or the poles, because S2 already "
        "gets them right. A ring on a sphere bounds two regions, though, and without winding "
        "there is nothing to say which one was meant, so S2 takes the smaller. That is right only "
        "while the polygon is smaller than a hemisphere."
    ),
    workaround_ids=(),
)

ORIENTED = Variant(
    id="oriented",
    name="Oriented",
    description="Winding order honored (`oriented=True`).",
    tradeoffs=("The caller must guarantee correct ring orientation; spherely won't check.",),
    how_it_helps=(
        "Tells S2 to trust the winding: the interior is the region on the ring's left, even when "
        "that is most of the globe. That is what `both_poles` needs."
    ),
    workaround_ids=(),
)


class SpherelySystem:
    """Adapter for spherely (S2)."""

    info = SystemInfo(
        id="spherely",
        name="spherely (S2)",
        version=spherely.__version__,
        semantics="spherical",
        notes=(
            "A spherical geometry library built on Google's S2. Edges are great-circle arcs, so "
            "polygons that cross the antimeridian or contain a pole are ordinary shapes rather "
            "than special cases. Whether it reads them the way you meant depends entirely on the "
            "`oriented` flag."
        ),
        limitations=(
            (
                "By default it ignores winding order and takes the smaller of the two regions a "
                "ring bounds, so it can't represent a polygon larger than a hemisphere."
            ),
            (
                "With `oriented=True` it trusts winding completely. A ring wound the wrong way "
                "silently becomes its complement."
            ),
        ),
        docs_url="https://spherely.readthedocs.io/",
    )

    variants = (DEFAULT, ORIENTED)

    def evaluate(
        self,
        polygon: TestPolygon,
        lons: NDArray[np.float64],
        lats: NDArray[np.float64],
        variant_id: str,
    ) -> SystemEvaluation:
        """Run one polygon through spherely under one variant.

        Args:
            polygon: The polygon to test.
            lons: Grid longitudes in degrees.
            lats: Grid latitudes in degrees.
            variant_id: Which variant to apply.

        Returns:
            What spherely reported.

        Raises:
            ValueError: If the variant id is not one of this system's.
        """
        if variant_id not in {"default", "oriented"}:
            raise ValueError(f"Unknown spherely variant: {variant_id}")
        oriented = variant_id == "oriented"

        ring = [(lon, lat) for lon, lat in polygon.polygon.coordinates[0]]

        # spherely has no standalone validation function, so "valid" means
        # "construction did not raise".
        try:
            geometry = cast("Any", spherely.create_polygon(ring, oriented=oriented))
        except Exception as error:  # noqa: BLE001 -- the message is the result we want
            return SystemEvaluation(
                accepted=False,
                validation_errors=(str(error),),
                submitted_geometry=polygon.polygon,
                contains=None,
                area_m2=None,
                bbox=None,
            )

        inside = np.asarray(
            cast("NDArray[np.bool_]", spherely.contains(geometry, spherely.points(lons, lats)))
        )
        area = float(cast("float", spherely.area(geometry, radius=EARTH_RADIUS_M)))

        return SystemEvaluation(
            accepted=True,
            validation_errors=(),
            # spherely is handed the polygon unchanged; the variants differ only
            # in how it reads the ring, not in what is submitted.
            submitted_geometry=polygon.polygon,
            contains=tuple(bool(value) for value in inside),
            area_m2=area,
            # spherely 0.1.1 has no bounding-box function.
            bbox=None,
        )
