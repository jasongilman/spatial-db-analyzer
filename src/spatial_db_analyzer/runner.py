"""Runs every polygon x system x variant combination and scores it.

Scoring compares each system's containment answers against the reference over
the point grid, ignoring points the reference skipped for sitting too close to
a boundary. Area and bounding box are recorded for display but do not affect
the outcome: a library that gets every point right is `correct` even if it
reports no area at all.
"""

import time
from datetime import UTC, datetime

import numpy as np

from spatial_db_analyzer.models import (
    CombinationResult,
    GridConfig,
    Outcome,
    ReferenceResult,
    ResultsFile,
    SystemInfo,
    TestPolygon,
    Variant,
)
from spatial_db_analyzer.point_grid import Grid, build_grid
from spatial_db_analyzer.reference import evaluate_polygon
from spatial_db_analyzer.systems import (
    ALL_SYSTEMS,
    REFERENCE_INFO,
    REFERENCE_VARIANT,
    REFERENCE_VARIANTS,
    SpatialSystem,
)
from spatial_db_analyzer.systems.base import SystemEvaluation
from spatial_db_analyzer.test_polygons import ALL_TEST_POLYGONS

COORDINATE_DECIMALS = 5
"""Coordinates are rounded to this many places on the way into the results file."""


def _score(
    evaluation: SystemEvaluation,
    reference: ReferenceResult,
    polygon: TestPolygon,
    point_count: int,
) -> tuple[Outcome, float | None, tuple[int, ...], tuple[int, ...]]:
    """Compare one evaluation against the reference.

    Args:
        evaluation: What the library reported.
        reference: Ground truth for this polygon.
        polygon: The polygon, for its expected validity.
        point_count: How many grid points there are.

    Returns:
        A tuple of the outcome, the agreement percentage, the false positive
        indices and the false negative indices.
    """
    rejected = not evaluation.accepted or (
        bool(evaluation.validation_errors) and polygon.expected_valid
    )
    if rejected or evaluation.contains is None:
        return "rejected", None, (), ()

    truth = np.zeros(point_count, dtype=np.bool_)
    truth[list(reference.inside_indices)] = True

    scored = np.ones(point_count, dtype=np.bool_)
    scored[list(reference.skipped_indices)] = False

    reported = np.array(evaluation.contains, dtype=np.bool_)

    false_positives = np.flatnonzero(scored & reported & ~truth)
    false_negatives = np.flatnonzero(scored & ~reported & truth)

    scored_count = int(np.count_nonzero(scored))
    wrong = len(false_positives) + len(false_negatives)
    agreement = 100.0 * (scored_count - wrong) / scored_count if scored_count else 100.0

    outcome: Outcome = "correct" if wrong == 0 else "accepted_but_wrong"
    return (
        outcome,
        agreement,
        tuple(int(index) for index in false_positives),
        tuple(int(index) for index in false_negatives),
    )


def _bbox_covers(evaluation: SystemEvaluation, reference: ReferenceResult) -> bool | None:
    """Test whether the library's bounding box contains the expected one.

    Args:
        evaluation: What the library reported.
        reference: Ground truth for this polygon.

    Returns:
        True or False, or None when either box is missing.
    """
    if evaluation.bbox is None or reference.bbox is None:
        return None

    theirs = evaluation.bbox
    expected = reference.bbox
    if theirs.south > expected.south or theirs.north < expected.north:
        return False

    # A library reporting west > east would mean an antimeridian-crossing box.
    # None of the planar systems do that, so a straight comparison is enough.
    return theirs.west <= expected.west and theirs.east >= expected.east


def run_combination(
    system: SpatialSystem,
    variant: Variant,
    polygon: TestPolygon,
    *,
    grid_points: Grid,
    reference: ReferenceResult,
) -> CombinationResult:
    """Run and score one polygon against one system variant.

    An unexpected exception is recorded as an `error` outcome and the run
    continues, so one broken adapter cannot lose the whole matrix.

    Args:
        system: The system to run.
        variant: The variant to apply.
        polygon: The polygon to test.
        grid_points: The test point grid.
        reference: Ground truth for this polygon.

    Returns:
        The scored result.
    """
    lons, lats = grid_points
    started = time.perf_counter()
    try:
        evaluation = system.evaluate(polygon, lons, lats, variant.id)
    except Exception as error:  # noqa: BLE001 -- one bad adapter must not stop the run
        return CombinationResult(
            polygon_id=polygon.id,
            system_id=system.info.id,
            variant_id=variant.id,
            outcome="error",
            accepted=False,
            validation_errors=(),
            error_message=f"{type(error).__name__}: {error}",
            submitted_geometry=polygon.polygon,
            agreement_pct=None,
            false_positive_indices=(),
            false_negative_indices=(),
            area_m2=None,
            area_error_pct=None,
            bbox=None,
            bbox_covers_expected=None,
            duration_ms=(time.perf_counter() - started) * 1000.0,
        )

    outcome, agreement, false_positives, false_negatives = _score(
        evaluation, reference, polygon, len(lons)
    )

    area_error_pct = None
    if evaluation.area_m2 is not None and reference.area_m2:
        area_error_pct = (evaluation.area_m2 - reference.area_m2) / reference.area_m2 * 100.0

    return CombinationResult(
        polygon_id=polygon.id,
        system_id=system.info.id,
        variant_id=variant.id,
        outcome=outcome,
        accepted=evaluation.accepted,
        validation_errors=evaluation.validation_errors,
        error_message=None,
        submitted_geometry=evaluation.submitted_geometry,
        agreement_pct=agreement,
        false_positive_indices=false_positives,
        false_negative_indices=false_negatives,
        area_m2=evaluation.area_m2,
        area_error_pct=area_error_pct,
        bbox=evaluation.bbox,
        bbox_covers_expected=_bbox_covers(evaluation, reference),
        duration_ms=(time.perf_counter() - started) * 1000.0,
    )


def _reference_combination(polygon: TestPolygon, reference: ReferenceResult) -> CombinationResult:
    """Build the control column's entry from ground truth already computed."""
    return CombinationResult(
        polygon_id=polygon.id,
        system_id=REFERENCE_INFO.id,
        variant_id=REFERENCE_VARIANT.id,
        outcome="correct",
        accepted=True,
        validation_errors=(),
        error_message=None,
        submitted_geometry=polygon.polygon,
        agreement_pct=100.0,
        false_positive_indices=(),
        false_negative_indices=(),
        area_m2=reference.area_m2,
        area_error_pct=0.0,
        bbox=reference.bbox,
        bbox_covers_expected=True if reference.bbox is not None else None,
        duration_ms=0.0,
    )


def run(
    grid: GridConfig | None = None,
    polygons: tuple[TestPolygon, ...] = ALL_TEST_POLYGONS,
    systems: tuple[SpatialSystem, ...] = ALL_SYSTEMS,
    *,
    compute_bbox: bool = True,
) -> ResultsFile:
    """Run every combination and build the results file.

    Args:
        grid: How to build the point grid; defaults to GridConfig's defaults.
        polygons: The polygons to test.
        systems: The systems to test, excluding the reference control column.
        compute_bbox: Whether to compute each polygon's expected bounding box.

    Returns:
        The complete results file, ready to serialize.
    """
    config = grid if grid is not None else GridConfig()
    lons, lats = build_grid(config.point_count, config.region)

    reference: dict[str, ReferenceResult] = {
        polygon.id: evaluate_polygon(
            polygon.polygon,
            lons,
            lats,
            config.edge_tolerance_deg,
            compute_bbox=compute_bbox,
        )
        for polygon in polygons
    }

    grid_points = Grid(lons, lats)
    results: list[CombinationResult] = []
    for polygon in polygons:
        results.append(_reference_combination(polygon, reference[polygon.id]))
        results.extend(
            run_combination(
                system,
                variant,
                polygon,
                grid_points=grid_points,
                reference=reference[polygon.id],
            )
            for system in systems
            for variant in system.variants
        )

    system_infos: tuple[SystemInfo, ...] = (
        REFERENCE_INFO,
        *(system.info for system in systems),
    )
    variants: dict[str, tuple[Variant, ...]] = {REFERENCE_INFO.id: REFERENCE_VARIANTS}
    for system in systems:
        variants[system.info.id] = system.variants

    points = tuple(
        (round(float(lon), COORDINATE_DECIMALS), round(float(lat), COORDINATE_DECIMALS))
        for lon, lat in zip(lons, lats, strict=True)
    )

    return ResultsFile(
        schema_version=1,
        generated_at=datetime.now(UTC),
        grid=config,
        points=points,
        polygons=polygons,
        reference=reference,
        systems=system_infos,
        variants=variants,
        results=tuple(results),
    )
