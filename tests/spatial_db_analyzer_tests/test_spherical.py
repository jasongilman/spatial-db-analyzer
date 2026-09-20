"""Tests for the spherical math and the reference implementation.

These are the tests that matter most: everything else in the project is scored
against this code, so a bug here would be reported as a library failure.
"""

import numpy as np
import pytest
import spherely
from numpy.typing import NDArray

from spatial_db_analyzer.point_grid import fibonacci_sphere
from spatial_db_analyzer.reference import expected_bbox
from spatial_db_analyzer.spherical import (
    EARTH_RADIUS_M,
    angular_distance_to_edges,
    contains,
    interpolate_great_circle,
    lonlat_to_xyz,
    ring_to_xyz,
    spherical_area,
    xyz_to_lonlat,
)
from spatial_db_analyzer.test_polygons import ALL_TEST_POLYGONS, POLYGONS_BY_ID

SPHERE_AREA_M2 = 4.0 * np.pi * EARTH_RADIUS_M**2

# Area as a fraction of the globe, from Appendix D of the Phase 1 plan. These
# were verified with spherely during planning, so they are an independent check
# on the area formula rather than a record of what this code happens to print.
EXPECTED_AREA_PCT = {
    "normal": 0.57,
    "north_pole": 5.53,
    "south_pole": 5.53,
    "both_poles": 87.91,
    "antimeridian": 3.94,
    "wide": 0.65,
}

# Hand-checked points, also from Appendix D.
HAND_CHECKED = {
    "normal": (((-100.0, 37.0), True),),
    "north_pole": (((0.0, 89.0), True),),
    "south_pole": (((0.0, -89.0), True),),
    "both_poles": (((0.0, 89.0), True), ((0.0, -89.0), True)),
    "antimeridian": (((180.0, 0.0), True), ((0.0, 0.0), False)),
    "wide": (((0.0, 84.0), True), ((0.0, 60.0), False)),
}

POLYGON_IDS = tuple(POLYGONS_BY_ID)


def _ring_xyz(polygon_id: str) -> NDArray[np.float64]:
    return ring_to_xyz(POLYGONS_BY_ID[polygon_id].polygon.coordinates[0])


def _point_xyz(lon: float, lat: float) -> NDArray[np.float64]:
    return lonlat_to_xyz(np.array([lon]), np.array([lat]))


def _grid_xyz(count: int = 5000) -> NDArray[np.float64]:
    lons, lats = fibonacci_sphere(count)
    return lonlat_to_xyz(lons, lats)


def _spherely_ring(polygon_id: str) -> list[tuple[float, float]]:
    ring = POLYGONS_BY_ID[polygon_id].polygon.coordinates[0]
    return [(lon, lat) for lon, lat in ring]


def test_lonlat_round_trips():
    lons = np.array([0.0, 45.0, -179.0, 179.0, -90.0])
    lats = np.array([0.0, 45.0, -20.0, 85.0, -85.0])
    back_lons, back_lats = xyz_to_lonlat(lonlat_to_xyz(lons, lats))
    assert np.allclose(back_lons, lons)
    assert np.allclose(back_lats, lats)


@pytest.mark.parametrize("polygon_id", POLYGON_IDS)
def test_hand_checked_points(polygon_id: str):
    ring_xyz = _ring_xyz(polygon_id)
    for (lon, lat), expected in HAND_CHECKED[polygon_id]:
        actual = bool(contains(ring_xyz, _point_xyz(lon, lat))[0])
        assert actual is expected, f"{polygon_id}: ({lon}, {lat}) should be inside={expected}"


@pytest.mark.parametrize("polygon_id", POLYGON_IDS)
def test_complement_property(polygon_id: str):
    """Reversing the ring must flip every point that is not on the boundary."""
    ring_xyz = _ring_xyz(polygon_id)
    points_xyz = _grid_xyz()
    keep = angular_distance_to_edges(ring_xyz, points_xyz) >= np.radians(0.25)

    forward = contains(ring_xyz, points_xyz)[keep]
    reversed_ring = contains(ring_xyz[::-1], points_xyz)[keep]
    assert np.all(forward != reversed_ring)


@pytest.mark.parametrize("polygon_id", POLYGON_IDS)
def test_area_plus_complement_is_the_whole_sphere(polygon_id: str):
    ring_xyz = _ring_xyz(polygon_id)
    total = spherical_area(ring_xyz) + spherical_area(ring_xyz[::-1])
    assert total == pytest.approx(SPHERE_AREA_M2, rel=1e-12)


@pytest.mark.parametrize("polygon_id", POLYGON_IDS)
def test_area_matches_the_pinned_fraction(polygon_id: str):
    ring_xyz = _ring_xyz(polygon_id)
    fraction_pct = spherical_area(ring_xyz) / SPHERE_AREA_M2 * 100.0
    assert fraction_pct == pytest.approx(EXPECTED_AREA_PCT[polygon_id], abs=0.02)


def test_octant_area_is_an_eighth_of_the_sphere():
    """The triangle bounded by the equator and two meridians 90 degrees apart."""
    ring = ((0.0, 0.0), (90.0, 0.0), (0.0, 90.0), (0.0, 0.0))
    area = spherical_area(ring_to_xyz(ring))
    assert area == pytest.approx(SPHERE_AREA_M2 / 8.0, rel=1e-12)


def test_area_matches_spherely():
    for polygon in ALL_TEST_POLYGONS:
        ring_xyz = _ring_xyz(polygon.id)
        theirs = spherely.area(
            spherely.create_polygon(_spherely_ring(polygon.id), oriented=True),
            radius=EARTH_RADIUS_M,
        )
        assert spherical_area(ring_xyz) == pytest.approx(theirs, rel=1e-9), polygon.id


@pytest.mark.parametrize("polygon_id", POLYGON_IDS)
def test_reference_matches_spherely(polygon_id: str):
    """The cross-check that validates the whole reference implementation.

    If this fails, stop: every downstream result is measured against this code.
    """
    ring_xyz = _ring_xyz(polygon_id)
    lons, lats = fibonacci_sphere(5000)
    points_xyz = lonlat_to_xyz(lons, lats)
    keep = angular_distance_to_edges(ring_xyz, points_xyz) >= np.radians(0.25)

    ours = contains(ring_xyz, points_xyz)[keep]
    theirs = np.asarray(
        spherely.contains(
            spherely.create_polygon(_spherely_ring(polygon_id), oriented=True),
            spherely.points(lons[keep], lats[keep]),
        )
    )
    disagreements = int(np.count_nonzero(ours != theirs))
    assert disagreements == 0, (
        f"{polygon_id}: reference and spherely disagree on {disagreements} of {len(ours)} points"
    )


def test_angular_distance_to_a_meridian_edge():
    """A point 1 degree east of a north-south edge is 1 degree from it."""
    ring = ((0.0, -10.0), (0.0, 10.0), (-5.0, 10.0), (-5.0, -10.0), (0.0, -10.0))
    ring_xyz = ring_to_xyz(ring)
    distance = angular_distance_to_edges(ring_xyz, _point_xyz(1.0, 0.0))
    assert float(np.degrees(distance[0])) == pytest.approx(1.0, abs=1e-9)


def test_angular_distance_falls_back_to_the_nearest_endpoint():
    """Beyond an edge's end, the nearest boundary point is the vertex itself."""
    ring = ((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0))
    ring_xyz = ring_to_xyz(ring)
    # North-east of the (10, 10) corner, on the diagonal, so no edge's great
    # circle passes nearer than the corner does.
    distance = angular_distance_to_edges(ring_xyz, _point_xyz(20.0, 20.0))
    corner = _point_xyz(10.0, 10.0)[0]
    point = _point_xyz(20.0, 20.0)[0]
    expected = float(np.arccos(np.clip(float(np.dot(corner, point)), -1.0, 1.0)))
    assert float(distance[0]) == pytest.approx(expected, rel=1e-9)


def test_points_on_the_boundary_have_near_zero_distance():
    ring_xyz = _ring_xyz("normal")
    # A vertex, and a point on the western edge. Meridians are great circles, so
    # a point at the same longitude as that edge lies exactly on it.
    for lon, lat in ((-110.0, 30.0), (-110.0, 37.0)):
        assert float(angular_distance_to_edges(ring_xyz, _point_xyz(lon, lat))[0]) < 1e-12


def test_a_point_on_the_drawn_parallel_is_off_the_real_boundary():
    """The `normal` box's bottom edge bows north, so (-100, 30) is not on it.

    This is the same sliver that stops planar variants from scoring exactly
    `correct` on the control polygon.
    """
    ring_xyz = _ring_xyz("normal")
    distance_deg = float(
        np.degrees(angular_distance_to_edges(ring_xyz, _point_xyz(-100.0, 30.0))[0])
    )
    assert distance_deg == pytest.approx(0.38, abs=0.02)


def test_interpolate_great_circle_stays_on_the_sphere_and_respects_the_step():
    a = _point_xyz(-80.0, 50.0)[0]
    b = _point_xyz(80.0, 50.0)[0]
    path = interpolate_great_circle(a, b, max_step_deg=1.0)

    assert np.allclose(np.linalg.norm(path, axis=1), 1.0)
    assert np.allclose(path[0], a)
    steps = np.degrees(np.arccos(np.clip(np.sum(path[:-1] * path[1:], axis=1), -1.0, 1.0)))
    assert float(steps.max()) <= 1.0 + 1e-9


def test_interpolate_great_circle_bows_poleward():
    """The midpoint of the `wide` polygon's bottom edge sits far north of 50 degrees."""
    a = _point_xyz(-80.0, 50.0)[0]
    b = _point_xyz(80.0, 50.0)[0]
    path = interpolate_great_circle(a, b, max_step_deg=1.0)
    _, lats = xyz_to_lonlat(path)
    assert float(lats.max()) == pytest.approx(81.71, abs=0.02)


def test_expected_bbox_of_an_ordinary_box_includes_the_bowed_edge():
    box = expected_bbox(_ring_xyz("normal"))
    assert box.west == pytest.approx(-110.0)
    assert box.east == pytest.approx(-90.0)
    assert box.south == pytest.approx(30.0)
    # The top edge bows north of its 45-degree endpoints.
    assert box.north > 45.0
    assert box.north == pytest.approx(45.44, abs=0.02)


def test_expected_bbox_reaches_the_pole_when_the_pole_is_inside():
    box = expected_bbox(_ring_xyz("north_pole"))
    assert box.north == pytest.approx(90.0)
    assert box.west == pytest.approx(-180.0)
    assert box.east == pytest.approx(180.0)
    assert box.south == pytest.approx(55.0, abs=0.01)


def test_expected_bbox_crosses_the_antimeridian():
    box = expected_bbox(_ring_xyz("antimeridian"))
    assert box.west == pytest.approx(160.0)
    assert box.east == pytest.approx(-160.0)
    assert box.west > box.east, "a crossing box is signalled by west > east"
    assert box.north == pytest.approx(21.17, abs=0.02)
    assert box.south == pytest.approx(-21.17, abs=0.02)


def test_expected_bbox_of_the_wide_band_reaches_the_bowed_top_edge():
    box = expected_bbox(_ring_xyz("wide"))
    assert box.south == pytest.approx(50.0)
    assert box.north == pytest.approx(86.38, abs=0.02)
