"""Ground truth: spherical containment, area and bounding box for one polygon.

This module is the yardstick every system is scored against, so it is
deliberately small and leans on :mod:`spatial_db_analyzer.spherical` for the
math. Its correctness is pinned by hand-checked points, by property tests, and
by a cross-check against spherely (S2).
"""

import numpy as np
from numpy.typing import NDArray

from spatial_db_analyzer.models import BBox, GeoJsonPolygon, ReferenceResult
from spatial_db_analyzer.spherical import (
    angular_distance_to_edges,
    contains,
    cross,
    dot,
    lonlat_to_xyz,
    normalize,
    ring_to_xyz,
    spherical_area,
    xyz_to_lonlat,
)

POLE_LAT = 90.0
"""Latitude of a pole in degrees."""

HALF_TURN_DEG = 180.0
"""Half a turn of longitude in degrees."""

EQUATORIAL_NORMAL_TOL = 1e-12
"""Below this, an edge's great-circle normal is vertical and the edge follows the equator."""


def _pole_is_inside(ring_xyz: NDArray[np.float64], *, north: bool) -> bool:
    """Test whether a pole lies inside the ring."""
    pole = np.array([[0.0, 0.0, 1.0 if north else -1.0]])
    return bool(contains(ring_xyz, pole)[0])


def _edge_latitude_extremes(a: NDArray[np.float64], b: NDArray[np.float64]) -> tuple[float, float]:
    """Find the lowest and highest latitude reached along one great-circle edge.

    A great-circle arc bows toward the nearer pole, so its extreme latitude can
    sit strictly between its endpoints. That interior maximum only counts when
    it actually falls on the arc rather than elsewhere on the circle.

    Args:
        a: The edge's start vertex as a unit vector.
        b: The edge's end vertex as a unit vector.

    Returns:
        A ``(min_lat, max_lat)`` pair in degrees.
    """
    _, endpoint_lats = xyz_to_lonlat(np.stack([a, b]))
    lowest = float(endpoint_lats.min())
    highest = float(endpoint_lats.max())

    normal = normalize(cross(a, b))
    # The two points on this great circle furthest from the equator sit a
    # quarter turn from where the circle crosses it.
    horizontal = float(np.hypot(normal[0], normal[1]))
    if horizontal < EQUATORIAL_NORMAL_TOL:
        # The edge follows the equator; its endpoints already bound it.
        return lowest, highest

    apex = np.array([-normal[0] * normal[2], -normal[1] * normal[2], horizontal * horizontal])
    apex = normalize(apex)
    for candidate in (apex, -apex):
        if _point_on_arc(candidate, a, b, normal):
            _, candidate_lat = xyz_to_lonlat(candidate[None, :])
            lowest = min(lowest, float(candidate_lat[0]))
            highest = max(highest, float(candidate_lat[0]))
    return lowest, highest


def _point_on_arc(
    point: NDArray[np.float64],
    a: NDArray[np.float64],
    b: NDArray[np.float64],
    normal: NDArray[np.float64],
) -> bool:
    """Test whether a point already on an edge's great circle lies within the arc."""
    return bool(dot(cross(a, point), normal) >= 0 and dot(cross(point, b), normal) >= 0)


def _longitude_span(ring_xyz: NDArray[np.float64]) -> tuple[float, float]:
    """Find the smallest longitude interval covering every edge of the ring.

    Walks the ring accumulating each edge's signed longitude step, which keeps
    an antimeridian crossing continuous instead of jumping 360 degrees.

    Args:
        ring_xyz: The ring's vertices as unit vectors.

    Returns:
        A ``(west, east)`` pair in degrees. ``west > east`` means the interval
        crosses the antimeridian.
    """
    lons, _ = xyz_to_lonlat(ring_xyz)
    unwrapped = [float(lons[0])]
    for index in range(1, len(lons)):
        step = float(lons[index]) - float(lons[index - 1])
        step = (step + HALF_TURN_DEG) % (2.0 * HALF_TURN_DEG) - HALF_TURN_DEG
        unwrapped.append(unwrapped[-1] + step)

    lowest = min(unwrapped)
    highest = max(unwrapped)
    if highest - lowest >= 2.0 * HALF_TURN_DEG:
        return -HALF_TURN_DEG, HALF_TURN_DEG

    west = (lowest + HALF_TURN_DEG) % (2.0 * HALF_TURN_DEG) - HALF_TURN_DEG
    east = (highest + HALF_TURN_DEG) % (2.0 * HALF_TURN_DEG) - HALF_TURN_DEG
    return west, east


def expected_bbox(ring_xyz: NDArray[np.float64]) -> BBox:
    """Compute the true geodetic bounding box of a spherical polygon.

    Latitude extremes include each edge's interior maximum, not only its
    vertices, because great-circle edges bow poleward. If a pole is inside the
    polygon, latitude runs all the way to that pole and longitude covers the
    whole range, since every meridian passes through it.

    Args:
        ring_xyz: The ring's vertices as unit vectors, wound interior-on-the-left.

    Returns:
        The bounding box.
    """
    starts = ring_xyz
    ends = np.roll(ring_xyz, -1, axis=0)

    south = POLE_LAT
    north = -POLE_LAT
    for start, end in zip(starts, ends, strict=True):
        lowest, highest = _edge_latitude_extremes(start, end)
        south = min(south, lowest)
        north = max(north, highest)

    north_inside = _pole_is_inside(ring_xyz, north=True)
    south_inside = _pole_is_inside(ring_xyz, north=False)

    if north_inside:
        north = POLE_LAT
    if south_inside:
        south = -POLE_LAT
    if north_inside or south_inside:
        return BBox(west=-HALF_TURN_DEG, south=south, east=HALF_TURN_DEG, north=north)

    west, east = _longitude_span(ring_xyz)
    return BBox(west=west, south=south, east=east, north=north)


def evaluate_polygon(
    polygon: GeoJsonPolygon,
    lons: NDArray[np.float64],
    lats: NDArray[np.float64],
    edge_tolerance_deg: float,
    *,
    compute_bbox: bool = True,
) -> ReferenceResult:
    """Compute ground truth for one polygon over the test grid.

    Args:
        polygon: The polygon, wound interior-on-the-left.
        lons: Grid longitudes in degrees.
        lats: Grid latitudes in degrees.
        edge_tolerance_deg: Points nearer than this to the boundary are skipped.
        compute_bbox: Whether to compute the expected bounding box.

    Returns:
        The reference result for this polygon.
    """
    ring_xyz = ring_to_xyz(polygon.coordinates[0])
    points_xyz = lonlat_to_xyz(lons, lats)

    inside = contains(ring_xyz, points_xyz)
    distances = angular_distance_to_edges(ring_xyz, points_xyz)
    skipped = distances < np.radians(edge_tolerance_deg)

    inside_indices = tuple(int(index) for index in np.flatnonzero(inside & ~skipped))
    skipped_indices = tuple(int(index) for index in np.flatnonzero(skipped))

    return ReferenceResult(
        inside_indices=inside_indices,
        skipped_indices=skipped_indices,
        area_m2=spherical_area(ring_xyz),
        bbox=expected_bbox(ring_xyz) if compute_bbox else None,
    )
