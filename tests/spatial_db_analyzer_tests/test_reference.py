"""Tests for the reference evaluation that produces each polygon's ground truth."""

import numpy as np
import pytest

from spatial_db_analyzer.models import ReferenceResult
from spatial_db_analyzer.point_grid import fibonacci_sphere
from spatial_db_analyzer.reference import evaluate_polygon
from spatial_db_analyzer.spherical import EARTH_RADIUS_M
from spatial_db_analyzer.test_polygons import ALL_TEST_POLYGONS, POLYGONS_BY_ID

SPHERE_AREA_M2 = 4.0 * np.pi * EARTH_RADIUS_M**2
POLYGON_IDS = tuple(polygon.id for polygon in ALL_TEST_POLYGONS)


def _evaluate(polygon_id: str, count: int = 2000, *, compute_bbox: bool = True) -> ReferenceResult:
    lons, lats = fibonacci_sphere(count)
    return evaluate_polygon(
        POLYGONS_BY_ID[polygon_id].polygon,
        lons,
        lats,
        edge_tolerance_deg=0.25,
        compute_bbox=compute_bbox,
    )


@pytest.mark.parametrize("polygon_id", POLYGON_IDS)
def test_indices_are_sorted_disjoint_and_in_range(polygon_id: str):
    result = _evaluate(polygon_id)
    assert list(result.inside_indices) == sorted(result.inside_indices)
    assert list(result.skipped_indices) == sorted(result.skipped_indices)
    assert not set(result.inside_indices) & set(result.skipped_indices), (
        "a skipped point must not also be reported as inside"
    )
    for index in (*result.inside_indices, *result.skipped_indices):
        assert 0 <= index < 2000


@pytest.mark.parametrize("polygon_id", POLYGON_IDS)
def test_inside_fraction_tracks_the_area_fraction(polygon_id: str):
    """With an even grid, the share of points inside should match the area share."""
    result = _evaluate(polygon_id, count=20000)
    scored = 20000 - len(result.skipped_indices)
    inside_fraction = len(result.inside_indices) / scored
    area_fraction = result.area_m2 / SPHERE_AREA_M2
    assert inside_fraction == pytest.approx(area_fraction, abs=0.01)


def test_bbox_can_be_skipped():
    result = _evaluate("normal", compute_bbox=False)
    assert result.bbox is None


def test_bbox_is_computed_by_default():
    result = _evaluate("normal")
    assert result.bbox is not None


def test_a_tighter_tolerance_skips_fewer_points():
    lons, lats = fibonacci_sphere(5000)
    polygon = POLYGONS_BY_ID["normal"].polygon
    loose = evaluate_polygon(polygon, lons, lats, edge_tolerance_deg=2.0)
    tight = evaluate_polygon(polygon, lons, lats, edge_tolerance_deg=0.25)
    assert len(tight.skipped_indices) < len(loose.skipped_indices)
