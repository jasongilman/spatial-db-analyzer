"""Command line entry point: run every combination and write the results file."""

import argparse
import sys
from pathlib import Path

from spatial_db_analyzer.models import BBox, GridConfig, ResultsFile
from spatial_db_analyzer.runner import run
from spatial_db_analyzer.systems import ALL_SYSTEMS
from spatial_db_analyzer.test_polygons import ALL_TEST_POLYGONS

REGION_PART_COUNT = 4
"""A --region value is west,south,east,north."""


def parse_region(text: str) -> BBox:
    """Parse a ``W,S,E,N`` region argument.

    Args:
        text: The comma-separated value.

    Returns:
        The bounding box.

    Raises:
        argparse.ArgumentTypeError: If the value is not four numbers.
    """
    parts = text.split(",")
    if len(parts) != REGION_PART_COUNT:
        raise argparse.ArgumentTypeError(f"--region needs four values (W,S,E,N), got {text!r}")
    try:
        west, south, east, north = (float(part) for part in parts)
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"--region values must be numbers: {text!r}") from error
    return BBox(west=west, south=south, east=east, north=north)


def _parse_ids(text: str) -> tuple[str, ...]:
    """Split a comma-separated list of ids, dropping blanks.

    Args:
        text: The comma-separated value.

    Returns:
        The ids, in the order given.

    Raises:
        argparse.ArgumentTypeError: If the value names no ids at all. An empty
            selection is never what the caller meant, and left alone it runs
            nothing and overwrites the results file with an empty matrix.
    """
    ids = tuple(part.strip() for part in text.split(",") if part.strip())
    if not ids:
        raise argparse.ArgumentTypeError(f"expected at least one id, got {text!r}")
    return ids


def summary_table(results: ResultsFile) -> str:
    """Render the results as a plain-text matrix for the terminal.

    This is how a run is sanity-checked before the front end is opened.

    Args:
        results: The completed results file.

    Returns:
        The table, as a string without a trailing newline.
    """
    columns = [
        (system.id, variant.id)
        for system in results.systems
        for variant in results.variants[system.id]
    ]
    by_key = {
        (result.polygon_id, result.system_id, result.variant_id): result
        for result in results.results
    }

    symbols = {
        "correct": "ok",
        "accepted_but_wrong": "WRONG",
        "rejected": "rej",
        "error": "ERR",
        "no_data": "NONE",
    }
    headers = [f"{system}/{variant}" for system, variant in columns]
    widths = [max(len(header), 13) for header in headers]
    label_width = max((len(polygon.id) for polygon in results.polygons), default=0)

    lines = [
        " " * label_width
        + "  "
        + "  ".join(h.ljust(w) for h, w in zip(headers, widths, strict=True))
    ]
    for polygon in results.polygons:
        cells: list[str] = []
        for (system_id, variant_id), width in zip(columns, widths, strict=True):
            result = by_key[polygon.id, system_id, variant_id]
            mark = symbols[result.outcome]
            percentage = (
                "  --  " if result.agreement_pct is None else f"{result.agreement_pct:5.1f}%"
            )
            cells.append(f"{mark} {percentage}".ljust(width))
        lines.append(polygon.id.ljust(label_width) + "  " + "  ".join(cells))
    return "\n".join(lines)


def _build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    defaults = GridConfig()
    parser = argparse.ArgumentParser(
        prog="spatial-db-analyzer",
        description="Compares how spatial databases and libraries handle geodetic polygons.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    run_parser = subparsers.add_parser("run", help="Run every combination and write results JSON.")
    run_parser.add_argument(
        "--points",
        type=int,
        default=defaults.point_count,
        help="How many test points to spread over the globe (default: %(default)s).",
    )
    run_parser.add_argument(
        "--region",
        type=parse_region,
        default=defaults.region,
        help=(
            "Limit the grid to a W,S,E,N window. West greater than east crosses the "
            "antimeridian. Use --region=W,S,E,N when the first value is negative."
        ),
    )
    run_parser.add_argument(
        "--edge-tolerance",
        type=float,
        default=defaults.edge_tolerance_deg,
        help="Skip points within this many degrees of a polygon edge (default: %(default)s).",
    )
    run_parser.add_argument(
        "--systems",
        type=_parse_ids,
        default=None,
        help="Comma-separated system ids to run (default: all).",
    )
    run_parser.add_argument(
        "--polygons",
        type=_parse_ids,
        default=None,
        help="Comma-separated polygon ids to run (default: all).",
    )
    run_parser.add_argument(
        "--output",
        type=Path,
        default=Path("frontend/public/results.json"),
        help="Where to write the results JSON (default: %(default)s).",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Run the CLI.

    Args:
        argv: Arguments to parse; defaults to the process arguments.

    Returns:
        A process exit code.
    """
    args = _build_parser().parse_args(argv)

    polygons = ALL_TEST_POLYGONS
    if args.polygons is not None:
        wanted: tuple[str, ...] = args.polygons
        polygons = tuple(polygon for polygon in ALL_TEST_POLYGONS if polygon.id in wanted)
        missing = set(wanted) - {polygon.id for polygon in polygons}
        if missing:
            print(f"Unknown polygon ids: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    systems = ALL_SYSTEMS
    if args.systems is not None:
        wanted_systems: tuple[str, ...] = args.systems
        systems = tuple(system for system in ALL_SYSTEMS if system.info.id in wanted_systems)
        missing = set(wanted_systems) - {system.info.id for system in systems}
        if missing:
            print(f"Unknown system ids: {', '.join(sorted(missing))}", file=sys.stderr)
            return 2

    grid = GridConfig(
        point_count=args.points,
        region=args.region,
        edge_tolerance_deg=args.edge_tolerance,
    )
    results = run(grid=grid, polygons=polygons, systems=systems)

    output: Path = args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(results.model_dump_json(indent=None), encoding="utf-8")

    print(summary_table(results))
    print()
    print(f"Wrote {output} ({output.stat().st_size / 1_000_000:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
