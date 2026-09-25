"""The reference implementation presented as a control column in the matrix.

This is not a system under test. It scores 100% by construction, which is the
point: it shows a reader what a passing row looks like before they read the
failures, and it makes the yardstick visible instead of implicit. The runner
fills this column from the already-computed reference result rather than
running anything again.
"""

from spatial_db_analyzer.models import SystemInfo, Variant

REFERENCE_VARIANT = Variant(
    id="reference",
    name="Reference",
    description="Our own spherical implementation, shown as a control.",
    tradeoffs=("Scores 100% by definition; it is the yardstick, not a contender.",),
    how_it_helps="Not a workaround. This is the ground truth every other column is scored against.",
    workaround_ids=(),
)

REFERENCE_INFO = SystemInfo(
    id="reference",
    name="Reference (ours)",
    version="1",
    semantics="spherical",
    notes=(
        "The spherical implementation this project measures everything else against: containment "
        "by great-circle edge crossings, and exact spherical area. It is cross-checked against "
        "spherely on every grid point in the test suite."
    ),
    limitations=(),
    docs_url=(
        "https://github.com/jasongilman/spatial-db-analyzer/blob/main/src/spatial_db_analyzer/"
        "reference.py"
    ),
)

REFERENCE_VARIANTS = (REFERENCE_VARIANT,)
