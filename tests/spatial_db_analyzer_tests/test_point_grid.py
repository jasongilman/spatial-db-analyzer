"""Tests for the Fibonacci-sphere point grid and its region filter."""

import numpy as np
import pytest

from spatial_db_analyzer.models import BBox
from spatial_db_analyzer.point_grid import build_grid, fibonacci_sphere, in_region
from spatial_db_analyzer.spherical import lonlat_to_xyz


def test_point_count_is_exact():
    for count in (1, 7, 200, 5000):
        lons, lats = fibonacci_sphere(count)
        assert len(lons) == count
        assert len(lats) == count


def test_rejects_a_non_positive_count():
    with pytest.raises(ValueError, match="must be positive"):
        fibonacci_sphere(0)


def test_coordinates_stay_in_range():
    lons, lats = fibonacci_sphere(5000)
    assert float(lons.min()) >= -180.0
    assert float(lons.max()) <= 180.0
    assert float(lats.min()) >= -90.0
    assert float(lats.max()) <= 90.0


def test_points_are_evenly_spread():
    """Nearest-neighbor spacing should vary little; that is the point of the spiral.

    A lon/lat lattice would fail this badly, with spacing collapsing toward the
    poles.
    """
    lons, lats = fibonacci_sphere(1000)
    xyz = lonlat_to_xyz(lons, lats)

    dots = np.clip(xyz @ xyz.T, -1.0, 1.0)
    np.fill_diagonal(dots, -1.0)
    nearest = np.arccos(dots).min(axis=1)

    assert float(nearest.std() / nearest.mean()) < 0.1


def test_points_cover_both_hemispheres_evenly():
    lons, lats = fibonacci_sphere(5000)
    del lons
    northern = int(np.count_nonzero(lats > 0))
    assert northern == pytest.approx(2500, abs=5)


def test_region_filter_keeps_the_right_points():
    region = BBox(west=-10.0, south=-10.0, east=10.0, north=10.0)
    lons = np.array([0.0, 5.0, -5.0, 20.0, 0.0, 0.0])
    lats = np.array([0.0, 5.0, -5.0, 0.0, 20.0, -20.0])
    keep = in_region(lons, lats, region)
    assert list(keep) == [True, True, True, False, False, False]


def test_region_filter_handles_an_antimeridian_window():
    """West > east means the window runs east through +/-180."""
    region = BBox(west=160.0, south=-20.0, east=-160.0, north=20.0)
    lons = np.array([170.0, -170.0, 180.0, -180.0, 0.0, 100.0, -100.0])
    lats = np.zeros(7)
    keep = in_region(lons, lats, region)
    assert list(keep) == [True, True, True, True, False, False, False]


def test_region_filter_still_applies_latitude_across_the_antimeridian():
    region = BBox(west=160.0, south=-20.0, east=-160.0, north=20.0)
    lons = np.array([170.0, 170.0])
    lats = np.array([0.0, 40.0])
    assert list(in_region(lons, lats, region)) == [True, False]


def test_build_grid_without_a_region_returns_everything():
    lons, lats = build_grid(500)
    assert len(lons) == 500
    assert len(lats) == 500


def test_build_grid_with_a_region_returns_a_subset():
    region = BBox(west=-10.0, south=-10.0, east=10.0, north=10.0)
    lons, lats = build_grid(5000, region)

    assert 0 < len(lons) < 5000
    assert np.all(lons >= -10.0)
    assert np.all(lons <= 10.0)
    assert np.all(lats >= -10.0)
    assert np.all(lats <= 10.0)
