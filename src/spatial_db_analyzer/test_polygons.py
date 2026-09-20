"""The six scenario polygons, with the user-facing text explaining each one.

Rings are written without their closing point and closed by :func:`_polygon`.
All are wound so the interior lies to the left of each edge, which is the
GeoJSON (RFC 7946) convention. The coordinates and the expectations that go
with them were verified against spherely during planning.

Note for pytest: this module starts with ``test_`` but holds no tests. The
pytest config limits collection to ``tests/``, so it is never collected.
"""

from spatial_db_analyzer.models import GeoJsonPolygon, LonLat, TestPolygon


def _polygon(ring: tuple[LonLat, ...]) -> GeoJsonPolygon:
    """Close an open ring and wrap it as a GeoJSON polygon.

    Args:
        ring: The ring's positions, without the repeated closing point.

    Returns:
        The closed polygon.
    """
    return GeoJsonPolygon(coordinates=((*ring, ring[0]),))


NORMAL = TestPolygon(
    id="normal",
    name="Ordinary box",
    description=(
        "A box over the western United States, well away from the poles and the antimeridian. "
        "This is the control case: every library should get it essentially right. The only "
        "disagreement is a sliver, because the box's top and bottom edges are great-circle arcs "
        "that bow north of the straight lines a planar library draws between the same corners."
    ),
    polygon=_polygon(((-110.0, 30.0), (-90.0, 30.0), (-90.0, 45.0), (-110.0, 45.0))),
    expected_valid=True,
)

NORTH_POLE = TestPolygon(
    id="north_pole",
    name="Covers the North Pole",
    description=(
        "An irregular ring running right around the world between 55 and 70 degrees north. "
        "Because the ring is wound with its interior on the left, the region it encloses is the "
        "cap above it, which includes the North Pole. A planar library sees only a zigzag band "
        "of points and has no way to represent 'everything north of here', so it places the "
        "interior below the ring instead of above it."
    ),
    polygon=_polygon(
        (
            (-180.0, 60.0),
            (-135.0, 55.0),
            (-90.0, 65.0),
            (-45.0, 58.0),
            (0.0, 70.0),
            (45.0, 60.0),
            (90.0, 66.0),
            (135.0, 57.0),
        )
    ),
    expected_valid=True,
)

SOUTH_POLE = TestPolygon(
    id="south_pole",
    name="Covers the South Pole",
    description=(
        "The mirror image of the North Pole case: a ring between 55 and 70 degrees south whose "
        "interior is the cap below it. It is included because a library can handle one pole and "
        "still get the other wrong, usually through a sign assumption somewhere in its "
        "projection code."
    ),
    polygon=_polygon(
        (
            (180.0, -60.0),
            (135.0, -55.0),
            (90.0, -65.0),
            (45.0, -58.0),
            (0.0, -70.0),
            (-45.0, -60.0),
            (-90.0, -66.0),
            (-135.0, -57.0),
        )
    ),
    expected_valid=True,
)

BOTH_POLES = TestPolygon(
    id="both_poles",
    name="Contains both poles",
    description=(
        "Read as a plain list of coordinates this looks like a small box over the eastern "
        "Pacific. Under the interior-on-the-left rule it means the opposite: everything except "
        "that box, which is about 88 percent of the globe and contains both poles. This is the "
        "case where winding order carries the entire meaning, and it is what a library gets "
        "wrong when it quietly normalizes rings or picks the smaller of the two candidates."
    ),
    polygon=_polygon(((-150.0, -30.0), (-150.0, 40.0), (-80.0, 40.0), (-80.0, -30.0))),
    expected_valid=True,
)

ANTIMERIDIAN = TestPolygon(
    id="antimeridian",
    name="Crosses the antimeridian",
    description=(
        "A box over the central Pacific running from 160 degrees east to 160 degrees west, so it "
        "spans the 180-degree line. A planar library reads the jump from 160 to -160 as a step "
        "backwards across the whole map, and ends up with a box covering most of the world "
        "except the Pacific: the exact complement of what was meant."
    ),
    polygon=_polygon(((160.0, -20.0), (-160.0, -20.0), (-160.0, 20.0), (160.0, 20.0))),
    expected_valid=True,
)

WIDE = TestPolygon(
    id="wide",
    name="Wide band of latitude",
    description=(
        "A band from 80 degrees west to 80 degrees east, between 50 and 70 degrees north. Its "
        "edges are great-circle arcs, which bow toward the pole: the bottom edge peaks at 81.7 "
        "degrees north and the top edge at 86.4, so the true shape is a crescent sitting high "
        "above the rectangle a planar library draws. A point at 84 degrees north is inside, and "
        "a point at 60 degrees north, which looks well within the band, is outside."
    ),
    polygon=_polygon(((-80.0, 50.0), (80.0, 50.0), (80.0, 70.0), (-80.0, 70.0))),
    expected_valid=True,
)

ALL_TEST_POLYGONS: tuple[TestPolygon, ...] = (
    NORMAL,
    NORTH_POLE,
    SOUTH_POLE,
    BOTH_POLES,
    ANTIMERIDIAN,
    WIDE,
)
"""Every scenario, in the order the summary matrix shows them."""

POLYGONS_BY_ID: dict[str, TestPolygon] = {polygon.id: polygon for polygon in ALL_TEST_POLYGONS}
"""The same scenarios, keyed by id."""
