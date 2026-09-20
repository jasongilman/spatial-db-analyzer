"""Builds the grid of test points that every system is scored against.

A Fibonacci (golden-angle) spiral spreads points almost evenly over the sphere,
which matters because a naive lon/lat lattice piles up at the poles, exactly
where the interesting failures are.
"""

from typing import NamedTuple

import numpy as np
from numpy.typing import NDArray

from spatial_db_analyzer.models import BBox

GOLDEN_ANGLE = np.pi * (3.0 - np.sqrt(5.0))
"""The golden angle in radians, the longitude step of the spiral."""

HALF_TURN_DEG = 180.0
"""Half a turn in degrees; longitudes at or above this wrap into the negative half."""


class Grid(NamedTuple):
    """The test points, as parallel arrays of degrees."""

    lons: NDArray[np.float64]
    lats: NDArray[np.float64]


def fibonacci_sphere(count: int) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Generate evenly spread points over the whole sphere.

    Args:
        count: How many points to generate.

    Returns:
        A ``(lons, lats)`` pair of degree arrays, each of length ``count``.

    Raises:
        ValueError: If ``count`` is not positive.
    """
    if count <= 0:
        raise ValueError(f"point count must be positive, got {count}")

    indices = np.arange(count, dtype=np.float64)
    z = 1.0 - (2.0 * indices + 1.0) / count
    lats = np.degrees(np.arcsin(np.clip(z, -1.0, 1.0)))

    lon_rad = np.mod(indices * GOLDEN_ANGLE, 2.0 * np.pi)
    lons: NDArray[np.float64] = np.degrees(lon_rad)
    # Bring 180..360 down into the -180..0 half, so every longitude is in -180..180.
    wrapped = lons >= HALF_TURN_DEG
    lons[wrapped] -= 2.0 * HALF_TURN_DEG
    return lons, lats


def in_region(
    lons: NDArray[np.float64], lats: NDArray[np.float64], region: BBox
) -> NDArray[np.bool_]:
    """Test which points fall inside a lon/lat window.

    A window with ``west > east`` crosses the antimeridian, and so runs east
    from ``west`` through +/-180 to ``east`` rather than the long way round.

    Args:
        lons: Longitudes in degrees.
        lats: Latitudes in degrees, the same shape as ``lons``.
        region: The window to test against.

    Returns:
        A boolean array, True where the point is inside the window.
    """
    within_lat = (lats >= region.south) & (lats <= region.north)
    if region.west <= region.east:
        within_lon = (lons >= region.west) & (lons <= region.east)
    else:
        within_lon = (lons >= region.west) | (lons <= region.east)
    return within_lat & within_lon


def build_grid(count: int, region: BBox | None = None) -> Grid:
    """Build the test grid, optionally limited to a region.

    The region is applied as a filter after generation, so ``count`` is the
    number of points spread over the whole globe and the result is however many
    of those land in the window.

    Args:
        count: How many points to spread over the globe.
        region: Optional window limiting which points are kept.

    Returns:
        The grid, as a ``(lons, lats)`` pair of degree arrays.
    """
    lons, lats = fibonacci_sphere(count)
    if region is None:
        return Grid(lons, lats)
    keep = in_region(lons, lats, region)
    return Grid(lons[keep], lats[keep])
