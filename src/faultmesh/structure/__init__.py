"""Offline static project structure mapping."""

from faultmesh.structure.export import (
    build_coverage_overlay,
    build_structure_export,
    load_structure_export,
    load_v2_export,
)
from faultmesh.structure.git_changes import (
    GitAnalysis,
    StructureGitError,
    compare_git,
    materialize_revision,
)
from faultmesh.structure.index import build_structure_index
from faultmesh.structure.models import RelationshipIndex, StructureExport, StructureIndex
from faultmesh.structure.relationships import build_relationships

__all__ = [
    "RelationshipIndex",
    "GitAnalysis",
    "StructureGitError",
    "StructureExport",
    "StructureIndex",
    "build_coverage_overlay",
    "build_relationships",
    "build_structure_export",
    "build_structure_index",
    "compare_git",
    "load_structure_export",
    "load_v2_export",
    "materialize_revision",
]
