"""Emits ResultsFile's JSON Schema in the dialect json-schema-to-typescript understands.

pydantic emits draft 2020-12, where a fixed-length tuple is ``prefixItems``.
json-schema-to-typescript 16 only understands the draft-07 spelling, where a
tuple is ``items`` holding a list, and renders every ``prefixItems`` entry as
``unknown``. That would turn every coordinate in the results file into
``unknown[]``, which is unusable under strictTypeChecked.

This rewrites ``prefixItems`` to the draft-07 form so the generated types keep
their real ``[number, number]`` shapes. Run through scripts/generate_types.sh.
"""

import json
from typing import Any

from spatial_db_analyzer.models import ResultsFile


def to_draft_07_tuples(node: Any) -> Any:  # noqa: ANN401  # walks arbitrary JSON Schema
    """Rewrite every ``prefixItems`` in a schema into draft-07's list-valued ``items``.

    Args:
        node: Any JSON Schema fragment: an object, a list, or a scalar.

    Returns:
        The same fragment with tuple schemas rewritten in place of ``prefixItems``.
    """
    if isinstance(node, list):
        items: list[Any] = node
        return [to_draft_07_tuples(item) for item in items]
    if not isinstance(node, dict):
        return node

    mapping: dict[str, Any] = node
    result = {key: to_draft_07_tuples(value) for key, value in mapping.items()}
    if "prefixItems" in result:
        # A schema cannot carry both spellings, so the "rest of the array" schema
        # that draft 2020-12 puts in `items` has to go. Our tuples are all fixed
        # length (minItems == maxItems), so there is no rest to describe.
        result["items"] = result.pop("prefixItems")
    return result


def main() -> None:
    """Print the rewritten schema to stdout."""
    print(json.dumps(to_draft_07_tuples(ResultsFile.model_json_schema())))


if __name__ == "__main__":
    main()
