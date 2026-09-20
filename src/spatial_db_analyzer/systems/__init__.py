"""Adapters that run each spatial library against the test polygons."""

from spatial_db_analyzer.systems.base import SpatialSystem, SystemEvaluation
from spatial_db_analyzer.systems.duckdb_spatial import DuckDbSpatialSystem
from spatial_db_analyzer.systems.reference_system import (
    REFERENCE_INFO,
    REFERENCE_VARIANT,
    REFERENCE_VARIANTS,
)
from spatial_db_analyzer.systems.shapely_system import ShapelySystem
from spatial_db_analyzer.systems.spherely_system import SpherelySystem

ALL_SYSTEMS: tuple[SpatialSystem, ...] = (
    ShapelySystem(),
    DuckDbSpatialSystem(),
    SpherelySystem(),
)
"""Every system under test, in the order the summary matrix shows them.

The reference control column is not here: it is synthesized by the runner from
the ground truth it already computed.
"""

__all__ = [
    "ALL_SYSTEMS",
    "REFERENCE_INFO",
    "REFERENCE_VARIANT",
    "REFERENCE_VARIANTS",
    "DuckDbSpatialSystem",
    "ShapelySystem",
    "SpatialSystem",
    "SpherelySystem",
    "SystemEvaluation",
]
