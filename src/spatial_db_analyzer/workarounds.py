"""The preprocessing steps people actually apply before handing a polygon to a planar library.

Two workarounds are covered:

* :func:`densify` adds vertices along each great-circle edge, so that a library
  drawing straight lines between them stays close to the true arc.
* :func:`fix_antimeridian` runs the ``antimeridian`` package, the common
  documented fix, which splits a crossing polygon at +/-180 and closes
  pole-covering polygons along +/-90 latitude.

Each has costs, which the UI shows alongside the result; the point of running
them is to make those costs visible rather than to make the failures go away.
"""

from typing import Any, cast

import antimeridian
import numpy as np
from shapely.geometry import MultiPolygon, Polygon, mapping, shape

from spatial_db_analyzer.models import (
    MAX_LATITUDE,
    MAX_LONGITUDE,
    GeoJsonGeometry,
    GeoJsonMultiPolygon,
    GeoJsonPolygon,
    LonLat,
    WorkaroundInfo,
)
from spatial_db_analyzer.spherical import interpolate_great_circle, ring_to_xyz, xyz_to_lonlat

DEFAULT_DENSIFY_STEP_DEG = 1.0
"""Largest gap, in degrees, between vertices added along an edge."""

DENSIFY_INFO = WorkaroundInfo(
    id="densify",
    name="Great-circle densification",
    explanation=(
        "A planar library joins two vertices with a straight line in longitude and latitude, but "
        "the real edge is the great-circle arc between them, which bows toward the nearer pole. "
        "Points between the chord and the arc get the wrong answer. Densifying adds a vertex "
        "every 1 degree along the arc, so the library draws many short chords that hug the curve "
        "instead of one long chord that cuts the corner. The error left over shrinks roughly with "
        "the square of the step, so halving the step cuts it by about four, at the cost of many "
        "more vertices to store and test. On its own it does nothing about the antimeridian or "
        "the poles, so this project always follows it with the antimeridian fix."
    ),
)

ANTIMERIDIAN_INFO = WorkaroundInfo(
    id="antimeridian",
    name="Antimeridian fix",
    explanation=(
        "A planar library reads a ring from 160 to -160 degrees as running the long way around, "
        "west across 320 degrees of longitude, instead of 40 degrees east across +/-180. The "
        "`antimeridian` package splits such a polygon at +/-180 into a MultiPolygon with one part "
        "on each side. It finds where each edge crosses +/-180 along the great circle, but every "
        "edge stays a straight line, so it does nothing for a polygon with long edges."
        "\n\n"
        "The same package also handles a polygon that contains a pole. A ring around a pole has "
        "no inside on a flat map until it is closed, so the package closes it along +/-90 "
        "latitude, which turns a polar cap into a band across the top or bottom of the map."
        "\n\n"
        "By default it also rewinds rings (`fix_winding=True`), which reinterprets which side is "
        "the interior: a ring meant to cover 88% of the globe becomes the 12% box inside it."
    ),
)

ALL_WORKAROUNDS = (DENSIFY_INFO, ANTIMERIDIAN_INFO)
"""Every shared workaround, in the order the libraries page explains them."""


def _clamp(lon: float, lat: float) -> LonLat:
    """Pull a coordinate back inside the valid range after floating-point drift."""
    return (
        min(max(lon, -MAX_LONGITUDE), MAX_LONGITUDE),
        min(max(lat, -MAX_LATITUDE), MAX_LATITUDE),
    )


def densify(
    polygon: GeoJsonPolygon, max_step_deg: float = DEFAULT_DENSIFY_STEP_DEG
) -> GeoJsonPolygon:
    """Add vertices along each edge's great-circle arc.

    The added vertices sit on the true edge, so a library that joins them with
    straight lines approximates the arc instead of cutting the chord. The
    approximation is only as good as the step: error grows with segment length,
    and the vertex count grows with it too.

    Args:
        polygon: The polygon to densify.
        max_step_deg: Largest allowed gap between consecutive vertices.

    Returns:
        A polygon with the same shape and many more vertices.
    """
    ring_xyz = ring_to_xyz(polygon.coordinates[0])
    ends = np.roll(ring_xyz, -1, axis=0)

    segments = [
        interpolate_great_circle(start, end, max_step_deg)
        for start, end in zip(ring_xyz, ends, strict=True)
    ]
    dense_xyz = np.concatenate(segments, axis=0)

    lons, lats = xyz_to_lonlat(dense_xyz)
    positions = [_clamp(float(lon), float(lat)) for lon, lat in zip(lons, lats, strict=True)]
    return GeoJsonPolygon(coordinates=((*positions, positions[0]),))


def _to_geojson(geometry: Polygon | MultiPolygon) -> GeoJsonGeometry:
    """Convert a Shapely geometry back into one of this project's models.

    Args:
        geometry: A Shapely Polygon or MultiPolygon.

    Returns:
        The equivalent model.

    Raises:
        TypeError: If the geometry is neither of those two types.
    """
    raw: dict[str, Any] = mapping(geometry)
    kind = cast("str", raw["type"])

    if kind == "Polygon":
        rings = cast("tuple[tuple[tuple[float, float], ...], ...]", raw["coordinates"])
        ring = tuple(_clamp(lon, lat) for lon, lat in rings[0])
        return GeoJsonPolygon(coordinates=(ring,))

    if kind == "MultiPolygon":
        parts = cast("tuple[tuple[tuple[tuple[float, float], ...], ...], ...]", raw["coordinates"])
        return GeoJsonMultiPolygon(
            coordinates=tuple((tuple(_clamp(lon, lat) for lon, lat in part[0]),) for part in parts)
        )

    raise TypeError(f"Unexpected geometry type from the antimeridian fix: {kind}")


def to_shapely(geometry: GeoJsonGeometry) -> Polygon | MultiPolygon:
    """Convert one of this project's geometries into a Shapely one.

    Args:
        geometry: The geometry to convert.

    Returns:
        The Shapely equivalent.
    """
    return cast("Polygon | MultiPolygon", shape(geometry.model_dump()))


def fix_antimeridian(polygon: GeoJsonPolygon, *, fix_winding: bool) -> GeoJsonGeometry:
    """Apply the ``antimeridian`` package's fix.

    ``fix_winding`` is passed explicitly and never left to the library's
    default, which is ``True``. Rewinding reinterprets which side of a ring is
    the interior, so on a polygon whose meaning lives in its winding order it
    silently returns the complement of what was asked for. That is worth
    demonstrating as its own variant rather than tripping over by accident.

    Args:
        polygon: The polygon to fix.
        fix_winding: Whether to let the package reorient rings.

    Returns:
        The fixed geometry: a MultiPolygon when the polygon was split at
        +/-180, otherwise a Polygon.
    """
    original = cast("Polygon", to_shapely(polygon))
    fixed = antimeridian.fix_polygon(original, great_circle=True, fix_winding=fix_winding)
    return _to_geojson(fixed)
