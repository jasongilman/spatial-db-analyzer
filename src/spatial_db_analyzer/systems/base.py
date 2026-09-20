"""The interface every system adapter implements."""

from typing import Protocol, runtime_checkable

import numpy as np
from numpy.typing import NDArray

from spatial_db_analyzer.models import (
    BBox,
    GeoJsonGeometry,
    StrictModel,
    SystemInfo,
    TestPolygon,
    Variant,
)


class SystemEvaluation(StrictModel):
    """What one library reported for one polygon, before it is scored."""

    accepted: bool
    validation_errors: tuple[str, ...]
    submitted_geometry: GeoJsonGeometry
    contains: tuple[bool, ...] | None
    area_m2: float | None
    bbox: BBox | None


@runtime_checkable
class SpatialSystem(Protocol):
    """One library under test, with its variants."""

    @property
    def info(self) -> SystemInfo:
        """Identity and semantics of the library."""
        ...

    @property
    def variants(self) -> tuple[Variant, ...]:
        """The ways this library is fed a polygon: raw, plus its workarounds."""
        ...

    def evaluate(
        self,
        polygon: TestPolygon,
        lons: NDArray[np.float64],
        lats: NDArray[np.float64],
        variant_id: str,
    ) -> SystemEvaluation:
        """Run one polygon through this library under one variant.

        Args:
            polygon: The polygon to test.
            lons: Grid longitudes in degrees.
            lats: Grid latitudes in degrees.
            variant_id: Which variant to apply.

        Returns:
            What the library reported.
        """
        ...
