"""Pydantic models for the test inputs and the generated results file.

Every model is strict, frozen and rejects unknown keys, so a results file that
parses is a results file the front end can trust. Field descriptions flow into
the generated JSON Schema and from there into the front end's TypeScript types,
so they are written for a reader of either.
"""

from datetime import datetime
from typing import Annotated, ClassVar, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

LonLat = tuple[float, float]
"""A ``(longitude, latitude)`` pair in degrees."""

Outcome = Literal["correct", "disagrees", "rejected", "error", "no_data"]
"""The verdict for one combination; see the outcome table in the Phase 1 plan.

`no_data` means there was nothing to score: no grid points in the region, or
every point skipped for sitting too close to an edge. It is deliberately not
`correct`, because a run that compared nothing is not a run that agreed.
"""

MIN_RING_POSITIONS = 4
"""A closed ring needs at least three distinct corners plus the repeated first point."""

MAX_LONGITUDE = 180.0
"""Longitudes run -180..180; this project does not accept the 0..360 convention."""

MAX_LATITUDE = 90.0
"""Latitudes run -90..90."""


class StrictModel(BaseModel):
    """Base for every model here: strict, frozen, and no extra keys."""

    model_config = ConfigDict(strict=True, extra="forbid", frozen=True)


def _validate_ring(ring: tuple[LonLat, ...]) -> None:
    """Check one linear ring against the subset of RFC 7946 this project uses.

    Args:
        ring: The ring's positions, expected to be closed.

    Raises:
        ValueError: If the ring is too short, unclosed, or out of range.
    """
    if len(ring) < MIN_RING_POSITIONS:
        raise ValueError(f"A ring needs at least {MIN_RING_POSITIONS} positions, got {len(ring)}")
    if ring[0] != ring[-1]:
        raise ValueError(f"A ring must be closed; {ring[0]} != {ring[-1]}")
    for lon, lat in ring:
        if not -MAX_LONGITUDE <= lon <= MAX_LONGITUDE:
            raise ValueError(f"Longitude {lon} is outside -180..180")
        if not -MAX_LATITUDE <= lat <= MAX_LATITUDE:
            raise ValueError(f"Latitude {lat} is outside -90..90")


class GeoJsonPolygon(StrictModel):
    """A GeoJSON Polygon with exactly one ring.

    Holes are out of scope for Phase 1, so ``coordinates`` holds a single
    exterior ring, wound counter-clockwise with the interior on its left.
    """

    type: Literal["Polygon"] = "Polygon"
    coordinates: Annotated[
        tuple[tuple[LonLat, ...]],
        Field(description="Exactly one closed exterior ring of [lon, lat] positions in degrees."),
    ]

    @model_validator(mode="after")
    def _check_rings(self) -> Self:
        _validate_ring(self.coordinates[0])
        return self


class GeoJsonMultiPolygon(StrictModel):
    """A GeoJSON MultiPolygon whose members each have exactly one ring.

    Produced by the antimeridian workaround, which splits a crossing polygon
    into one part either side of +/-180 degrees.
    """

    type: Literal["MultiPolygon"] = "MultiPolygon"
    coordinates: Annotated[
        tuple[tuple[tuple[LonLat, ...]], ...],
        Field(description="One entry per part, each a single closed exterior ring."),
    ]

    @model_validator(mode="after")
    def _check_rings(self) -> Self:
        for part in self.coordinates:
            _validate_ring(part[0])
        return self


GeoJsonGeometry = GeoJsonPolygon | GeoJsonMultiPolygon
"""Either geometry a system may be handed, before or after a workaround."""


class BBox(StrictModel):
    """A longitude/latitude bounding box in degrees.

    A ``west`` greater than ``east`` means the box crosses the antimeridian: it runs east from
    ``west`` through +/-180 to ``east``, rather than west across the whole map.
    """

    west: Annotated[float, Field(description="Western edge in degrees, -180..180.")]
    south: Annotated[float, Field(description="Southern edge in degrees, -90..90.")]
    east: Annotated[float, Field(description="Eastern edge in degrees, -180..180.")]
    north: Annotated[float, Field(description="Northern edge in degrees, -90..90.")]


class TestPolygon(StrictModel):
    """One scenario: a polygon plus the user-facing text explaining what it shows."""

    # The name starts with "Test", so pytest tries to collect it. It is a model,
    # not a test class.
    __test__: ClassVar[bool] = False

    id: Annotated[str, Field(description="Stable identifier used in URLs and result keys.")]
    name: Annotated[str, Field(description="Short human-readable title.")]
    description: Annotated[
        str, Field(description="Explainer text the UI shows: what this case demonstrates.")
    ]
    polygon: GeoJsonPolygon
    expected_valid: Annotated[
        bool, Field(description="Whether a correct library should accept this polygon.")
    ]


class GridConfig(StrictModel):
    """How the test point grid was built.

    These defaults are the single source of truth; the CLI flags fall back to them.
    """

    point_count: Annotated[
        int, Field(default=5000, description="Number of Fibonacci-sphere points over the globe.")
    ] = 5000
    region: Annotated[
        BBox | None,
        Field(default=None, description="Optional window limiting the grid; None means global."),
    ] = None
    edge_tolerance_deg: Annotated[
        float,
        Field(
            default=0.25,
            description=(
                "Points within this angular distance of a polygon edge are skipped, because "
                "boundary behavior is ambiguous."
            ),
        ),
    ] = 0.25


class SystemInfo(StrictModel):
    """One library under test."""

    id: Annotated[str, Field(description="Stable identifier used in URLs and result keys.")]
    name: Annotated[str, Field(description="Display name, including the underlying engine.")]
    version: Annotated[str, Field(description="Version of the library actually used in the run.")]
    semantics: Annotated[
        Literal["planar", "spherical"],
        Field(description="Whether the library treats coordinates as a flat plane or a sphere."),
    ]
    notes: Annotated[str, Field(description="Short explanation of what this library is for.")]
    limitations: Annotated[
        tuple[str, ...],
        Field(
            description=(
                "What this library gets wrong with geodetic data, one short statement each. Empty "
                "only for the reference control."
            )
        ),
    ]
    docs_url: Annotated[str, Field(description="Link to the library's own documentation.")]


class Variant(StrictModel):
    """One way of feeding a polygon to a system: raw, or with a workaround applied."""

    id: Annotated[str, Field(description="Stable identifier, unique within its system.")]
    name: Annotated[str, Field(description="Short display name for the matrix column.")]
    description: Annotated[str, Field(description="What this variant does to the input.")]
    tradeoffs: Annotated[
        tuple[str, ...],
        Field(description="What the workaround costs. The real lesson of the detail view."),
    ]
    how_it_helps: Annotated[
        str,
        Field(description="Which of the system's limitations this variant addresses, and how."),
    ]
    workaround_ids: Annotated[
        tuple[str, ...],
        Field(description="Ids of the shared workarounds this variant applies, in order."),
    ]


class WorkaroundInfo(StrictModel):
    """One preprocessing step shared across adapters, explained once."""

    id: Annotated[
        str, Field(description="Stable identifier that Variant.workaround_ids refers to.")
    ]
    name: Annotated[str, Field(description="Short display name.")]
    explanation: Annotated[
        str,
        Field(
            description=(
                "What the step does to a polygon, and why it helps a planar library. Paragraphs "
                "are separated by a blank line."
            )
        ),
    ]


class ReferenceResult(StrictModel):
    """Ground truth for one polygon, from our own spherical implementation."""

    inside_indices: Annotated[
        tuple[int, ...], Field(description="Indices into ResultsFile.points that are inside.")
    ]
    skipped_indices: Annotated[
        tuple[int, ...],
        Field(description="Indices excluded from scoring for being too close to an edge."),
    ]
    area_m2: Annotated[float, Field(description="Exact spherical area in square meters.")]
    bbox: Annotated[
        BBox | None,
        Field(description="Expected geodetic bounding box, or None when it was not computed."),
    ]


class CombinationResult(StrictModel):
    """What one system's one variant did with one polygon."""

    polygon_id: str
    system_id: str
    variant_id: str
    outcome: Annotated[
        Outcome,
        Field(description="Overall verdict; see the outcome table in the Phase 1 plan."),
    ]
    accepted: Annotated[
        bool, Field(description="Whether the library took the polygon without rejecting it.")
    ]
    validation_errors: Annotated[
        tuple[str, ...], Field(description="Verbatim messages from the library's own validation.")
    ]
    error_message: Annotated[
        str | None, Field(description="Unexpected exception text, when one was raised.")
    ]
    submitted_geometry: Annotated[
        GeoJsonGeometry,
        Field(
            description=(
                "What was actually handed to the library after the workaround. The UI draws this "
                "as 'the library's view'."
            )
        ),
    ]
    agreement_pct: Annotated[
        float | None,
        Field(
            description=(
                "Percentage of non-skipped points matching the reference, or None when there "
                "was nothing to compare: the polygon was rejected or errored, or no point was "
                "scored at all."
            )
        ),
    ]
    false_positive_indices: Annotated[
        tuple[int, ...],
        Field(description="Indices into ResultsFile.points called inside that are outside."),
    ]
    false_negative_indices: Annotated[
        tuple[int, ...],
        Field(description="Indices into ResultsFile.points called outside that are inside."),
    ]
    area_m2: Annotated[
        float | None, Field(description="Library-reported area, or None when not comparable.")
    ]
    area_error_pct: Annotated[
        float | None, Field(description="Signed percentage difference from the reference area.")
    ]
    bbox: Annotated[
        BBox | None,
        Field(description="Bounding box the library reported, or None when it exposes none."),
    ]
    bbox_covers_expected: Annotated[
        bool | None,
        Field(description="Whether the library's bbox contains the expected one; None if unknown."),
    ]
    duration_ms: Annotated[
        float, Field(description="Wall-clock time for this combination, in milliseconds.")
    ]


class ResultsFile(StrictModel):
    """The whole precomputed results file the front end loads."""

    schema_version: Annotated[
        Literal[4], Field(description="Bumped whenever this file's shape changes.")
    ] = 4
    generated_at: Annotated[datetime, Field(description="When the run was made, in UTC.")]
    grid: GridConfig
    points: Annotated[
        tuple[LonLat, ...],
        Field(description="The test point grid. Every index elsewhere points in here."),
    ]
    polygons: tuple[TestPolygon, ...]
    reference: Annotated[
        dict[str, ReferenceResult], Field(description="Ground truth, keyed by polygon id.")
    ]
    systems: tuple[SystemInfo, ...]
    variants: Annotated[
        dict[str, tuple[Variant, ...]], Field(description="Variants keyed by system id.")
    ]
    workarounds: Annotated[
        tuple[WorkaroundInfo, ...],
        Field(description="The shared workarounds that variants refer to by id."),
    ]
    results: Annotated[
        tuple[CombinationResult, ...],
        Field(description="One entry per polygon x system x variant combination."),
    ]

    @model_validator(mode="after")
    def _check_workaround_ids(self) -> Self:
        known = {workaround.id for workaround in self.workarounds}
        for system_id, system_variants in self.variants.items():
            for variant in system_variants:
                unknown = set(variant.workaround_ids) - known
                if unknown:
                    raise ValueError(
                        f"Variant {system_id}/{variant.id} names unknown workarounds: "
                        f"{sorted(unknown)}"
                    )
        return self
