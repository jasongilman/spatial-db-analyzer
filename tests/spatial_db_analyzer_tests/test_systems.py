"""Tests for the system adapters, the workarounds, and the pinned expectations.

The expectations in this file were verified during planning, so they are
assertions about what these libraries do, not a record of what this code
happened to produce.
"""

import numpy as np
import pytest

from spatial_db_analyzer.models import (
    BBox,
    CombinationResult,
    GeoJsonMultiPolygon,
    GeoJsonPolygon,
    GridConfig,
    ReferenceResult,
    ResultsFile,
)
from spatial_db_analyzer.point_grid import Grid
from spatial_db_analyzer.reference import evaluate_polygon
from spatial_db_analyzer.runner import bbox_covers, run, run_combination
from spatial_db_analyzer.spherical import (
    angular_distance_to_edges,
    lonlat_to_xyz,
    ring_to_xyz,
    xyz_to_lonlat,
)
from spatial_db_analyzer.systems import ALL_SYSTEMS
from spatial_db_analyzer.systems.base import SystemEvaluation
from spatial_db_analyzer.test_polygons import POLYGONS_BY_ID
from spatial_db_analyzer.workarounds import densify, fix_antimeridian

# The grid size is pinned so the agreement numbers below are reproducible.
PINNED_POINTS = 5000


@pytest.fixture(scope="module")
def results() -> ResultsFile:
    """One full run, shared by every test in this module."""
    return run(grid=GridConfig(point_count=PINNED_POINTS))


def _result(
    results: ResultsFile, polygon_id: str, system_id: str, variant_id: str
) -> CombinationResult:
    for result in results.results:
        if (result.polygon_id, result.system_id, result.variant_id) == (
            polygon_id,
            system_id,
            variant_id,
        ):
            return result
    pytest.fail(f"no result for {polygon_id}/{system_id}/{variant_id}")


def test_every_combination_is_present(results: ResultsFile):
    expected = sum(len(results.variants[system.id]) for system in results.systems) * len(
        results.polygons
    )
    assert len(results.results) == expected
    # One control column plus shapely's four, duckdb's three and spherely's two.
    assert expected == 10 * 6


def test_the_reference_column_is_a_perfect_control(results: ResultsFile):
    for polygon in results.polygons:
        result = _result(results, polygon.id, "reference", "reference")
        assert result.outcome == "correct"
        assert result.agreement_pct == 100.0


def test_every_variant_nearly_agrees_on_the_control_polygon(results: ResultsFile):
    """`normal` is the case everything should get right.

    Planar variants are not asserted to be exactly `correct`: `normal`'s
    parallels bow to 30.38N and 45.44N, so a raw planar polygon disagrees over
    two slivers of roughly 9 square degrees. At this grid size that is about a
    one-in-five chance of a single stray point, and a near certainty on a finer
    grid. A stray point here is the right answer, not a bug.
    """
    for system in results.systems:
        for variant in results.variants[system.id]:
            result = _result(results, "normal", system.id, variant.id)
            assert result.agreement_pct is not None, f"{system.id}/{variant.id} was not scored"
            assert result.agreement_pct >= 99.9, f"{system.id}/{variant.id}"


def test_spherical_variants_are_exactly_correct_on_the_control_polygon(results: ResultsFile):
    for system in results.systems:
        if system.semantics != "spherical":
            continue
        for variant in results.variants[system.id]:
            result = _result(results, "normal", system.id, variant.id)
            assert result.outcome == "correct", f"{system.id}/{variant.id}"


def test_shapely_raw_gets_the_antimeridian_backwards(results: ResultsFile):
    """It excludes (179.9, 0), which is inside, and includes (0, 0), which is not."""
    result = _result(results, "antimeridian", "shapely", "raw")
    assert result.outcome == "disagrees"

    system = next(system for system in ALL_SYSTEMS if system.info.id == "shapely")
    lons = np.array([179.9, 0.0])
    lats = np.array([0.0, 0.0])
    evaluation = system.evaluate(POLYGONS_BY_ID["antimeridian"], lons, lats, "raw")

    assert evaluation.contains == (False, True), (
        "shapely should read the 160E..160W box as its complement"
    )


def test_spherely_default_returns_the_complement_of_both_poles(results: ResultsFile):
    """Ignoring winding, spherely picks the smaller candidate: the 12% box, not the 88% rest."""
    result = _result(results, "both_poles", "spherely", "default")
    assert result.outcome == "disagrees"
    assert result.area_m2 is not None

    reference_area = results.reference["both_poles"].area_m2
    sphere_area = reference_area / 0.8791
    assert result.area_m2 / sphere_area == pytest.approx(0.12, abs=0.01)


def test_spherely_oriented_is_correct_on_every_polygon(results: ResultsFile):
    for polygon in results.polygons:
        result = _result(results, polygon.id, "spherely", "oriented")
        assert result.outcome == "correct", polygon.id


def test_planar_systems_reject_the_pole_polygons(results: ResultsFile):
    """Read as a flat ring, a pole polygon closes across the map and self-intersects."""
    for system_id in ("shapely", "duckdb_spatial"):
        for polygon_id in ("north_pole", "south_pole"):
            result = _result(results, polygon_id, system_id, "raw")
            assert result.outcome == "rejected", f"{system_id}/{polygon_id}"
            assert result.validation_errors
            assert result.agreement_pct is None, "a rejected polygon has nothing to compare"
            assert result.false_positive_indices == ()
            assert result.false_negative_indices == ()


def test_rewinding_collapses_both_poles(results: ResultsFile):
    """The antimeridian package's default reinterprets the interior, losing 88% of the globe."""
    left_alone = _result(results, "both_poles", "shapely", "antimeridian_fix")
    rewound = _result(results, "both_poles", "shapely", "antimeridian_fix_rewound")

    assert left_alone.agreement_pct is not None
    assert rewound.agreement_pct is not None
    assert left_alone.agreement_pct > 80.0
    assert rewound.agreement_pct < 5.0


def test_densifying_fixes_the_wide_band_for_planar_systems(results: ResultsFile):
    """The whole point of densifying: straight segments now follow the bowed edge."""
    for system_id in ("shapely", "duckdb_spatial"):
        raw = _result(results, "wide", system_id, "raw")
        densified = _result(results, "wide", system_id, "densified_fix")
        assert raw.agreement_pct is not None
        assert densified.agreement_pct is not None
        assert densified.agreement_pct > raw.agreement_pct, system_id
        assert densified.agreement_pct > 99.0, system_id


def test_shapely_and_duckdb_agree_with_each_other(results: ResultsFile):
    """Both wrap GEOS, so their shared variants should reach the same answers."""
    for polygon in results.polygons:
        for variant_id in ("raw", "antimeridian_fix", "densified_fix"):
            shapely_result = _result(results, polygon.id, "shapely", variant_id)
            duckdb_result = _result(results, polygon.id, "duckdb_spatial", variant_id)
            assert shapely_result.outcome == duckdb_result.outcome, f"{polygon.id}/{variant_id}"


def test_planar_systems_report_no_area(results: ResultsFile):
    """Square degrees are not comparable to an area on a sphere, so nothing is recorded."""
    for system in results.systems:
        if system.semantics != "planar":
            continue
        for variant in results.variants[system.id]:
            for polygon in results.polygons:
                result = _result(results, polygon.id, system.id, variant.id)
                assert result.area_m2 is None
                assert result.area_error_pct is None


def test_bbox_of_a_planar_antimeridian_polygon_does_not_cover_the_truth(results: ResultsFile):
    result = _result(results, "antimeridian", "shapely", "raw")
    assert result.bbox is not None
    assert result.bbox.west < result.bbox.east, "a planar library cannot express a crossing box"
    assert result.bbox_covers_expected is False


def test_duckdb_does_not_reuse_a_stale_point_grid():
    """The adapter is a module-level singleton, so it outlives one run.

    Two grids of the same length are the dangerous case: keyed on length alone,
    the second silently gets the first grid's coordinates back.
    """
    system = next(system for system in ALL_SYSTEMS if system.info.id == "duckdb_spatial")
    polygon = POLYGONS_BY_ID["normal"]
    inside = (-100.0, 37.0)
    outside = (0.0, 0.0)

    first = system.evaluate(
        polygon,
        np.array([inside[0], outside[0]]),
        np.array([inside[1], outside[1]]),
        "raw",
    )
    second = system.evaluate(
        polygon,
        np.array([outside[0], inside[0]]),
        np.array([outside[1], inside[1]]),
        "raw",
    )

    assert first.contains == (True, False)
    assert second.contains == (False, True), "the second grid was answered from the first's table"


def _evaluation_with_bbox(bbox: BBox) -> SystemEvaluation:
    return SystemEvaluation(
        accepted=True,
        validation_errors=(),
        submitted_geometry=POLYGONS_BY_ID["normal"].polygon,
        contains=(),
        area_m2=None,
        bbox=bbox,
    )


def _reference_with_bbox(bbox: BBox) -> ReferenceResult:
    return ReferenceResult(inside_indices=(), skipped_indices=(), area_m2=1.0, bbox=bbox)


def test_a_bbox_check_handles_an_expected_box_that_crosses_the_antimeridian():
    """The latitudes match here on purpose: only the longitudes can decide it."""
    expected = _reference_with_bbox(BBox(west=160.0, south=-20.0, east=-160.0, north=20.0))

    # Runs the other way round the globe: it covers everything except the band.
    planar = BBox(west=-160.0, south=-20.0, east=160.0, north=20.0)
    assert bbox_covers(_evaluation_with_bbox(planar), expected) is False

    # The whole longitude range trivially covers both halves of the band.
    whole_world = BBox(west=-180.0, south=-20.0, east=180.0, north=20.0)
    assert bbox_covers(_evaluation_with_bbox(whole_world), expected) is True

    # A wider crossing box covers a narrower one.
    wider = BBox(west=150.0, south=-20.0, east=-150.0, north=20.0)
    assert bbox_covers(_evaluation_with_bbox(wider), expected) is True


def test_densify_adds_vertices_on_the_true_edge():
    polygon = POLYGONS_BY_ID["wide"].polygon
    dense = densify(polygon, max_step_deg=1.0)

    assert len(dense.coordinates[0]) > len(polygon.coordinates[0]) * 10
    assert dense.coordinates[0][0] == dense.coordinates[0][-1], "the ring must stay closed"

    # The densified bottom edge should reach the arc's true peak near 81.71N.
    lats = [lat for _, lat in dense.coordinates[0]]
    assert max(lats) == pytest.approx(86.38, abs=0.05)


def test_densify_keeps_the_same_shape():
    """Densifying must not move the boundary: every added vertex is on the original arc."""
    polygon = POLYGONS_BY_ID["normal"].polygon
    dense = densify(polygon, max_step_deg=1.0)

    original_xyz = ring_to_xyz(polygon.coordinates[0])
    dense_lons = np.array([lon for lon, _ in dense.coordinates[0]])
    dense_lats = np.array([lat for _, lat in dense.coordinates[0]])

    distances = angular_distance_to_edges(original_xyz, lonlat_to_xyz(dense_lons, dense_lats))
    assert float(distances.max()) < 1e-9


def test_fix_antimeridian_splits_a_crossing_box():
    fixed = fix_antimeridian(POLYGONS_BY_ID["antimeridian"].polygon, fix_winding=False)
    assert isinstance(fixed, GeoJsonMultiPolygon)
    assert len(fixed.coordinates) == 2

    # The split latitude is computed on the great circle, not at the corners.
    lats = [lat for part in fixed.coordinates for lon, lat in part[0] if abs(abs(lon) - 180) < 1e-9]
    assert max(lats) == pytest.approx(21.17, abs=0.01)


def test_fix_antimeridian_closes_a_pole_polygon_along_the_pole():
    fixed = fix_antimeridian(POLYGONS_BY_ID["north_pole"].polygon, fix_winding=False)
    rings = (
        [part[0] for part in fixed.coordinates]
        if isinstance(fixed, GeoJsonMultiPolygon)
        else [fixed.coordinates[0]]
    )
    lats = [lat for ring in rings for _, lat in ring]
    assert max(lats) == pytest.approx(90.0), "the fix closes pole coverage along +90 latitude"


def test_fix_winding_is_never_left_to_the_library_default():
    """Passing fix_winding explicitly is what separates the two shapely variants."""
    left_alone = fix_antimeridian(POLYGONS_BY_ID["both_poles"].polygon, fix_winding=False)
    rewound = fix_antimeridian(POLYGONS_BY_ID["both_poles"].polygon, fix_winding=True)
    assert left_alone != rewound


def test_an_unknown_variant_is_reported_as_an_error():
    """A bad variant id must not take down the run."""
    polygon = POLYGONS_BY_ID["normal"]
    lons = np.array([0.0, 10.0])
    lats = np.array([0.0, 10.0])
    reference = evaluate_polygon(polygon.polygon, lons, lats, 0.25)
    system = next(system for system in ALL_SYSTEMS if system.info.id == "shapely")
    bogus = system.variants[0].model_copy(update={"id": "nonsense"})

    result: CombinationResult = run_combination(
        system,
        bogus,
        polygon,
        grid_points=Grid(lons, lats),
        reference=reference,
    )
    assert result.outcome == "error"
    assert result.error_message is not None
    assert "nonsense" in result.error_message


def test_submitted_geometry_records_what_the_library_actually_saw(results: ResultsFile):
    raw = _result(results, "antimeridian", "shapely", "raw")
    fixed = _result(results, "antimeridian", "shapely", "antimeridian_fix")

    assert isinstance(raw.submitted_geometry, GeoJsonPolygon)
    assert raw.submitted_geometry == POLYGONS_BY_ID["antimeridian"].polygon
    assert isinstance(fixed.submitted_geometry, GeoJsonMultiPolygon)


def test_xyz_round_trip_of_a_densified_ring_stays_in_range():
    dense = densify(POLYGONS_BY_ID["both_poles"].polygon, max_step_deg=1.0)
    lons, lats = xyz_to_lonlat(ring_to_xyz(dense.coordinates[0]))
    assert float(np.abs(lons).max()) <= 180.0
    assert float(np.abs(lats).max()) <= 90.0
