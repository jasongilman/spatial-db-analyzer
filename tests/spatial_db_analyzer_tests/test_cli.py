"""End-to-end tests for the runner and the command line entry point."""

import json
from pathlib import Path

import pytest

from spatial_db_analyzer.cli import main, parse_region, summary_table
from spatial_db_analyzer.models import GridConfig, ResultsFile
from spatial_db_analyzer.runner import run
from spatial_db_analyzer.systems import ALL_SYSTEMS
from spatial_db_analyzer.test_polygons import ALL_TEST_POLYGONS

SMALL_GRID = 200


def test_a_small_run_produces_a_result_for_every_combination():
    results = run(grid=GridConfig(point_count=SMALL_GRID))

    expected_columns = 1 + sum(len(system.variants) for system in ALL_SYSTEMS)
    assert len(results.results) == expected_columns * len(ALL_TEST_POLYGONS)
    assert len(results.points) == SMALL_GRID
    assert set(results.reference) == {polygon.id for polygon in ALL_TEST_POLYGONS}


def test_the_written_file_validates_as_a_results_file(tmp_path: Path):
    output = tmp_path / "results.json"
    exit_code = main(["run", "--points", str(SMALL_GRID), "--output", str(output)])

    assert exit_code == 0
    restored = ResultsFile.model_validate_json(output.read_text(encoding="utf-8"))
    assert restored.schema_version == 1
    assert len(restored.points) == SMALL_GRID


def test_coordinates_are_rounded_for_the_wire():
    results = run(grid=GridConfig(point_count=SMALL_GRID))
    for lon, lat in results.points:
        assert lon == round(lon, 5)
        assert lat == round(lat, 5)


def test_every_index_points_inside_the_grid():
    results = run(grid=GridConfig(point_count=SMALL_GRID))
    for reference in results.reference.values():
        for index in (*reference.inside_indices, *reference.skipped_indices):
            assert 0 <= index < SMALL_GRID
    for result in results.results:
        for index in (*result.false_positive_indices, *result.false_negative_indices):
            assert 0 <= index < SMALL_GRID


def test_skipped_points_are_never_counted_as_wrong():
    results = run(grid=GridConfig(point_count=2000))
    for result in results.results:
        skipped = set(results.reference[result.polygon_id].skipped_indices)
        wrong = set(result.false_positive_indices) | set(result.false_negative_indices)
        assert not skipped & wrong, f"{result.polygon_id}/{result.system_id}/{result.variant_id}"


def test_a_rejected_combination_has_no_percentage_and_no_indices():
    results = run(grid=GridConfig(point_count=SMALL_GRID))
    rejected = [result for result in results.results if result.outcome in {"rejected", "error"}]
    assert rejected, "the pole polygons should be rejected by the planar systems"
    for result in rejected:
        assert result.agreement_pct is None
        assert result.false_positive_indices == ()
        assert result.false_negative_indices == ()


def test_selecting_a_subset_of_polygons_and_systems(tmp_path: Path):
    output = tmp_path / "subset.json"
    exit_code = main(
        [
            "run",
            "--points",
            str(SMALL_GRID),
            "--polygons",
            "normal,wide",
            "--systems",
            "spherely",
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    results = ResultsFile.model_validate_json(output.read_text(encoding="utf-8"))
    assert {polygon.id for polygon in results.polygons} == {"normal", "wide"}
    assert {system.id for system in results.systems} == {"reference", "spherely"}
    assert len(results.results) == 2 * 3


def test_an_unknown_polygon_id_is_an_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    exit_code = main(
        ["run", "--polygons", "nope", "--output", str(tmp_path / "x.json"), "--points", "50"]
    )
    assert exit_code == 2
    assert "Unknown polygon ids: nope" in capsys.readouterr().err


def test_an_unknown_system_id_is_an_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]):
    exit_code = main(
        ["run", "--systems", "nope", "--output", str(tmp_path / "x.json"), "--points", "50"]
    )
    assert exit_code == 2
    assert "Unknown system ids: nope" in capsys.readouterr().err


def test_the_region_flag_limits_the_grid(tmp_path: Path):
    output = tmp_path / "region.json"
    exit_code = main(
        [
            "run",
            "--points",
            "5000",
            # Written as one argument: a value starting with "-" would otherwise
            # be read as another flag.
            "--region=-10,-10,10,10",
            "--output",
            str(output),
        ]
    )

    assert exit_code == 0
    results = ResultsFile.model_validate_json(output.read_text(encoding="utf-8"))
    assert 0 < len(results.points) < 5000
    for lon, lat in results.points:
        assert -10.0 <= lon <= 10.0
        assert -10.0 <= lat <= 10.0


def test_region_parsing_rejects_bad_input():
    with pytest.raises(Exception, match="four values"):
        parse_region("1,2,3")
    with pytest.raises(Exception, match="must be numbers"):
        parse_region("a,b,c,d")


def test_region_parsing_accepts_an_antimeridian_window():
    region = parse_region("160,-20,-160,20")
    assert region.west == 160.0
    assert region.east == -160.0


def test_thesummary_table_has_a_row_per_polygon_and_marks_failures():
    results = run(grid=GridConfig(point_count=SMALL_GRID))
    table = summary_table(results)

    lines = table.splitlines()
    assert len(lines) == len(ALL_TEST_POLYGONS) + 1
    for polygon in ALL_TEST_POLYGONS:
        assert polygon.id in table
    assert "WRONG" in table
    assert "--" in table, "a combination with no percentage renders as a dash, never 0%"


def test_the_json_is_compact_enough_to_ship(tmp_path: Path):
    """The front end loads this file on every page load."""
    output = tmp_path / "full.json"
    assert main(["run", "--output", str(output)]) == 0
    size_mb = output.stat().st_size / 1_000_000
    assert size_mb < 10.0, f"results.json is {size_mb:.1f} MB"

    payload = json.loads(output.read_text(encoding="utf-8"))
    assert payload["schema_version"] == 1
