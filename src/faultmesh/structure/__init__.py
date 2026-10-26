"""Offline static project structure mapping."""

from faultmesh.structure.git_changes import GitAnalysis, StructureGitError, compare_git
from faultmesh.structure.index import build_structure_index
from faultmesh.structure.models import RelationshipIndex, StructureExport, StructureIndex
from faultmesh.structure.relationships import build_relationships

__all__ = [
    "RelationshipIndex",
    "GitAnalysis",
    "StructureGitError",
    "StructureExport",
    "StructureIndex",
    "build_relationships",
    "build_structure_index",
    "compare_git",
]
