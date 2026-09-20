"""Spherical vector math on the unit sphere, vectorized with numpy.

Everything here works in 3D unit vectors rather than degrees, because the
operations we need (does an arc cross another arc, what is the area of a ring,
how far is a point from an edge) are all sign tests and dot products in that
representation, and none of them care about the antimeridian or the poles.

The convention throughout is the GeoJSON one: a ring is wound so its interior
lies to the *left* of each edge. For an edge from ``a`` to ``b``, ``cross(a, b)``
points toward that interior side.
"""

import numpy as np
from numpy.typing import NDArray

EARTH_RADIUS_M = 6_371_010.0
"""Earth radius in meters, matching ``spherely.EARTH_RADIUS_METERS`` so areas compare."""

REFERENCE_OFFSET = 1e-6
"""How far off an edge to place the reference point, in radians (about 6 m).

Smaller offsets such as 1e-9 still work in float64, but leave only a few digits
of sign margin in the crossing test, and 1e-6 is just as reliably inside for
polygons of the size this project uses.
"""

ANTIPODAL_TOL = 1e-9
"""Angular slack, in radians, for calling a point antipodal to the reference point.

Unrelated to REFERENCE_OFFSET despite the similar magnitude: this one decides
when the minor arc from the reference point is too ill-defined to trust.
"""

COINCIDENT_TOL = 1e-12
"""Below this separation, in radians, two vertices are the same point and slerp is undefined."""


def cross(a: NDArray[np.float64], b: NDArray[np.float64]) -> NDArray[np.float64]:
    """Cross product, typed.

    numpy 2.5's stubs give ``np.cross`` an unknown return type, which pyright's
    strict mode refuses to propagate. Narrowing it once here keeps the cast out
    of every call site.

    Args:
        a: An ``(..., 3)`` array.
        b: An ``(..., 3)`` array, broadcastable against ``a``.

    Returns:
        The elementwise cross product.
    """
    return np.cross(a, b)


def dot(a: NDArray[np.float64], b: NDArray[np.float64]) -> NDArray[np.float64]:
    """Dot product over the last axis, broadcasting the leading axes.

    Args:
        a: An ``(..., 3)`` array.
        b: An ``(..., 3)`` array, broadcastable against ``a``.

    Returns:
        The elementwise dot product, with the last axis summed away.
    """
    products: NDArray[np.float64] = a * b
    return products.sum(axis=-1)


def lonlat_to_xyz(lons: NDArray[np.float64], lats: NDArray[np.float64]) -> NDArray[np.float64]:
    """Convert longitude/latitude degrees to unit vectors.

    Args:
        lons: Longitudes in degrees.
        lats: Latitudes in degrees, the same shape as ``lons``.

    Returns:
        An ``(n, 3)`` array of unit vectors.
    """
    lon_rad = np.radians(lons)
    lat_rad = np.radians(lats)
    cos_lat = np.cos(lat_rad)
    return np.stack(
        [cos_lat * np.cos(lon_rad), cos_lat * np.sin(lon_rad), np.sin(lat_rad)],
        axis=-1,
    )


def xyz_to_lonlat(xyz: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Convert unit vectors back to longitude/latitude degrees.

    Args:
        xyz: An ``(n, 3)`` array of unit vectors.

    Returns:
        A ``(lons, lats)`` pair of degree arrays.
    """
    x = xyz[..., 0]
    y = xyz[..., 1]
    z = xyz[..., 2]
    lons = np.degrees(np.arctan2(y, x))
    lats = np.degrees(np.arcsin(np.clip(z, -1.0, 1.0)))
    return lons, lats


def normalize(vectors: NDArray[np.float64]) -> NDArray[np.float64]:
    """Scale vectors to unit length.

    Args:
        vectors: An ``(..., 3)`` array.

    Returns:
        The same shape, with each vector scaled to length one. Zero-length
        vectors are left alone rather than producing NaN.
    """
    norms = np.linalg.norm(vectors, axis=-1, keepdims=True)
    return vectors / np.where(norms == 0, 1.0, norms)


def ring_to_xyz(ring: tuple[tuple[float, float], ...]) -> NDArray[np.float64]:
    """Convert a closed lon/lat ring to unit vectors, dropping the repeated last point.

    Args:
        ring: A closed ring of ``(lon, lat)`` pairs in degrees.

    Returns:
        An ``(n, 3)`` array of the ring's distinct vertices, in order.
    """
    lons = np.array([position[0] for position in ring], dtype=np.float64)
    lats = np.array([position[1] for position in ring], dtype=np.float64)
    xyz = lonlat_to_xyz(lons, lats)
    if len(xyz) > 1 and np.allclose(xyz[0], xyz[-1]):
        xyz = xyz[:-1]
    return xyz


def _edges(ring_xyz: NDArray[np.float64]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Return the ring's edge start and end vertices, wrapping the last edge to the first."""
    return ring_xyz, np.roll(ring_xyz, -1, axis=0)


def _reference_point(ring_xyz: NDArray[np.float64], *, inside: bool) -> NDArray[np.float64]:
    """Build a point just off the midpoint of the first edge.

    Args:
        ring_xyz: The ring's vertices as unit vectors.
        inside: True for a point just inside the ring, False for just outside.

    Returns:
        A single unit vector.
    """
    v0 = ring_xyz[0]
    v1 = ring_xyz[1]
    midpoint = normalize(v0 + v1)
    # cross(v0, v1) points to the left of travel, which by our winding convention
    # is the interior.
    interior_side = normalize(cross(v0, v1))
    offset = REFERENCE_OFFSET if inside else -REFERENCE_OFFSET
    return normalize(midpoint + offset * interior_side)


def _crossings(
    arc_starts: NDArray[np.float64],
    arc_ends: NDArray[np.float64],
    edge_starts: NDArray[np.float64],
    edge_ends: NDArray[np.float64],
) -> NDArray[np.int64]:
    """Count how many polygon edges each test arc crosses.

    Implements S2's "simple crossing" sign test: arcs ``(a, b)`` and ``(c, d)``
    cross when each arc's endpoints straddle the other's great circle, with
    consistent signs.

    Args:
        arc_starts: ``(n, 3)`` start vectors, one per test arc.
        arc_ends: ``(n, 3)`` end vectors, one per test arc.
        edge_starts: ``(m, 3)`` polygon edge start vectors.
        edge_ends: ``(m, 3)`` polygon edge end vectors.

    Returns:
        An ``(n,)`` array of crossing counts.
    """
    # Broadcast to (n, m, 3): every test arc against every polygon edge.
    a = arc_starts[:, None, :]
    b = arc_ends[:, None, :]
    c = edge_starts[None, :, :]
    d = edge_ends[None, :, :]

    ab = cross(a, b)
    acb = -dot(ab, c)
    bda = dot(ab, d)

    cd = cross(c, d)
    cbd = -dot(cd, b)
    dac = dot(cd, a)

    crosses = (acb * bda > 0) & (acb * cbd > 0) & (acb * dac > 0)
    return np.count_nonzero(crosses, axis=1).astype(np.int64)


def contains(ring_xyz: NDArray[np.float64], points_xyz: NDArray[np.float64]) -> NDArray[np.bool_]:
    """Decide which points lie inside a spherical polygon.

    Counts how many polygon edges the minor arc from a known-inside reference
    point to each test point crosses. An even count means the point is inside,
    since each crossing flips which side of the boundary we are on.

    Args:
        ring_xyz: ``(m, 3)`` ring vertices, wound interior-on-the-left.
        points_xyz: ``(n, 3)`` test points.

    Returns:
        An ``(n,)`` boolean array, True where the point is inside.
    """
    if len(points_xyz) == 0:
        return np.zeros(0, dtype=np.bool_)

    edge_starts, edge_ends = _edges(ring_xyz)

    inside_ref = _reference_point(ring_xyz, inside=True)
    refs = np.broadcast_to(inside_ref, points_xyz.shape)
    counts = _crossings(refs, points_xyz, edge_starts, edge_ends)
    result = counts % 2 == 0

    # Where the test point is nearly antipodal to the reference point, the minor
    # arc between them is ill-defined. Redo those from a point just *outside* the
    # same edge, where an odd count means inside.
    dots = np.clip(dot(points_xyz, np.broadcast_to(inside_ref, points_xyz.shape)), -1.0, 1.0)
    antipodal = np.arccos(dots) > np.pi - ANTIPODAL_TOL
    if bool(np.any(antipodal)):
        outside_ref = _reference_point(ring_xyz, inside=False)
        subset = points_xyz[antipodal]
        alt_refs = np.broadcast_to(outside_ref, subset.shape)
        alt_counts = _crossings(alt_refs, subset, edge_starts, edge_ends)
        result[antipodal] = alt_counts % 2 == 1

    return result


def angular_distance_to_edges(
    ring_xyz: NDArray[np.float64], points_xyz: NDArray[np.float64]
) -> NDArray[np.float64]:
    """Find each point's smallest angular distance to the polygon boundary.

    For each edge, the distance to that edge's full great circle is
    ``|asin(dot(p, n))|`` where ``n`` is the circle's normal. That is only the
    distance to the *arc* when the point projects inside it; otherwise the
    nearest part of the arc is one of its endpoints.

    Args:
        ring_xyz: ``(m, 3)`` ring vertices.
        points_xyz: ``(n, 3)`` test points.

    Returns:
        An ``(n,)`` array of angular distances in radians.
    """
    if len(points_xyz) == 0:
        return np.zeros(0, dtype=np.float64)

    edge_starts, edge_ends = _edges(ring_xyz)
    normals = normalize(cross(edge_starts, edge_ends))

    p = points_xyz[:, None, :]
    a = edge_starts[None, :, :]
    b = edge_ends[None, :, :]
    n = normals[None, :, :]

    signed = dot(p, n)
    circle_distance = np.abs(np.arcsin(np.clip(signed, -1.0, 1.0)))

    # The point projected onto each edge's great circle.
    projected = normalize(p - signed[..., None] * n)
    within = (dot(cross(a, projected), n) >= 0) & (dot(cross(projected, b), n) >= 0)

    to_a = np.arccos(np.clip(dot(p, a), -1.0, 1.0))
    to_b = np.arccos(np.clip(dot(p, b), -1.0, 1.0))
    endpoint_distance = np.minimum(to_a, to_b)

    # Written as an indexed assignment rather than np.where because np.where's
    # overloads resolve to a partially-unknown type under pyright strict.
    per_edge = circle_distance.copy()
    outside_arc = ~within
    per_edge[outside_arc] = endpoint_distance[outside_arc]
    nearest: NDArray[np.float64] = per_edge.min(axis=1)
    return nearest


def spherical_area(ring_xyz: NDArray[np.float64], radius_m: float = EARTH_RADIUS_M) -> float:
    """Compute a spherical polygon's exact area.

    Fan-triangulates from the first vertex and sums signed spherical excesses
    with the Van Oosterom-Strackee formula. Signed contributions cancel
    correctly for non-convex rings, and adding a full sphere to a negative total
    handles polygons larger than a hemisphere.

    Args:
        ring_xyz: ``(m, 3)`` ring vertices, wound interior-on-the-left.
        radius_m: Sphere radius in meters.

    Returns:
        Area in square meters.
    """
    v0 = ring_xyz[0]
    b = ring_xyz[1:-1]
    c = ring_xyz[2:]

    numerator = dot(v0, cross(b, c))
    denominator = 1.0 + dot(v0, b) + dot(b, c) + dot(c, v0)
    excesses: NDArray[np.float64] = 2.0 * np.arctan2(numerator, denominator)
    excess = float(excesses.sum())

    if excess < 0:
        excess += 4.0 * np.pi
    return excess * radius_m * radius_m


def interpolate_great_circle(
    a: NDArray[np.float64], b: NDArray[np.float64], max_step_deg: float
) -> NDArray[np.float64]:
    """Place points along the great-circle arc from ``a`` to ``b``.

    Args:
        a: The start vertex as a unit vector.
        b: The end vertex as a unit vector.
        max_step_deg: Largest allowed gap between consecutive output points.

    Returns:
        An ``(k, 3)`` array starting at ``a`` and ending just before ``b``, so
        that concatenating consecutive edges produces no duplicates.
    """
    omega = float(np.arccos(np.clip(float(np.dot(a, b)), -1.0, 1.0)))
    steps = max(1, int(np.ceil(np.degrees(omega) / max_step_deg)))
    fractions = np.arange(steps, dtype=np.float64) / steps

    if omega < COINCIDENT_TOL:
        return np.broadcast_to(a, (steps, 3)).copy()

    sin_omega = np.sin(omega)
    weight_a = np.sin((1.0 - fractions) * omega) / sin_omega
    weight_b = np.sin(fractions * omega) / sin_omega
    return normalize(weight_a[:, None] * a[None, :] + weight_b[:, None] * b[None, :])
