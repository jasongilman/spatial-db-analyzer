"""Tests for the pydantic models: round-tripping and the ring validators."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from spatial_db_analyzer.models import (
    BBox,
    CombinationResult,
    GeoJsonMultiPolygon,
    GeoJsonPolygon,
    GridConfig,
    ReferenceResult,
    ResultsFile,
    SystemInfo,
    TestPolygon,
    Variant,
)

SQUARE = ((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0), (0.0, 0.0))


def _results_file() -> ResultsFile:
    polygon = GeoJsonPolygon(coordinates=(SQUARE,))
    return ResultsFile(
        schema_version=2,
        generated_at=datetime(2026, 9, 20, 12, 0, tzinfo=UTC),
        grid=GridConfig(point_count=3, region=None, edge_tolerance_deg=0.25),
        points=((0.0, 0.0), (5.0, 5.0), (90.0, 45.0)),
        polygons=(
            TestPolygon(
                id="square",
                name="Square",
                description="A small box near the equator.",
                polygon=polygon,
                expected_valid=True,
            ),
        ),
        reference={
            "square": ReferenceResult(
                inside_indices=(1,),
                skipped_indices=(0,),
                area_m2=1.2e12,
                bbox=BBox(west=0.0, south=0.0, east=10.0, north=10.0),
            )
        },
        systems=(
            SystemInfo(
                id="shapely",
                name="Shapely (GEOS)",
                version="2.1.2",
                semantics="planar",
                notes="Planar geometry engine.",
            ),
        ),
        variants={
            "shapely": (
                Variant(
                    id="raw",
                    name="Raw input",
                    description="The polygon as-is.",
                    tradeoffs=("Geodetic cases are wrong.",),
                ),
            )
        },
        results=(
            CombinationResult(
                polygon_id="square",
                system_id="shapely",
                variant_id="raw",
                outcome="correct",
                accepted=True,
                validation_errors=(),
                error_message=None,
                submitted_geometry=polygon,
                agreement_pct=100.0,
                false_positive_indices=(),
                false_negative_indices=(),
                area_m2=None,
                area_error_pct=None,
                bbox=BBox(west=0.0, south=0.0, east=10.0, north=10.0),
                bbox_covers_expected=True,
                duration_ms=1.5,
            ),
        ),
    )


def test_results_file_round_trips():
    original = _results_file()
    restored = ResultsFile.model_validate_json(original.model_dump_json())
    assert restored == original


def test_results_file_round_trip_keeps_multipolygon_geometry():
    original = _results_file()
    multi = GeoJsonMultiPolygon(coordinates=((SQUARE,), (SQUARE,)))
    amended = original.model_copy(
        update={
            "results": (original.results[0].model_copy(update={"submitted_geometry": multi}),),
        }
    )
    restored = ResultsFile.model_validate_json(amended.model_dump_json())
    assert restored.results[0].submitted_geometry == multi


def test_polygon_rejects_unclosed_ring():
    with pytest.raises(ValidationError, match="must be closed"):
        GeoJsonPolygon(coordinates=(((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)),))


def test_polygon_rejects_out_of_range_longitude():
    ring = ((0.0, 0.0), (181.0, 0.0), (10.0, 10.0), (0.0, 0.0))
    with pytest.raises(ValidationError, match=r"outside -180\.\.180"):
        GeoJsonPolygon(coordinates=(ring,))


def test_polygon_rejects_out_of_range_latitude():
    ring = ((0.0, 0.0), (10.0, 91.0), (10.0, 10.0), (0.0, 0.0))
    with pytest.raises(ValidationError, match=r"outside -90\.\.90"):
        GeoJsonPolygon(coordinates=(ring,))


def test_polygon_rejects_too_few_positions():
    with pytest.raises(ValidationError, match="at least 4 positions"):
        GeoJsonPolygon(coordinates=(((0.0, 0.0), (10.0, 0.0), (0.0, 0.0)),))


def test_multipolygon_validates_every_part():
    good = (SQUARE,)
    bad = (((0.0, 0.0), (10.0, 0.0), (10.0, 10.0), (0.0, 10.0)),)
    with pytest.raises(ValidationError, match="must be closed"):
        GeoJsonMultiPolygon(coordinates=(good, bad))


def test_models_are_frozen_and_forbid_extras():
    box = BBox(west=0.0, south=0.0, east=10.0, north=10.0)
    with pytest.raises(ValidationError):
        box.west = 5.0  # type: ignore[misc]
    with pytest.raises(ValidationError):
        BBox.model_validate({"west": 0.0, "south": 0.0, "east": 10.0, "north": 10.0, "extra": True})


def test_grid_config_defaults_are_the_single_source_of_truth():
    grid = GridConfig()
    assert grid.point_count == 5000
    assert grid.region is None
    assert grid.edge_tolerance_deg == 0.25
