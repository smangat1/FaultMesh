"""Semantic validation for the closed executable property language."""

from __future__ import annotations

from faultmesh.schemas import FunctionMetadata, ProjectIndex, PropertySpec, ResultBoundOracle


class SpecificationError(ValueError):
    pass


class SpecificationValidator:
    def validate(self, specification: PropertySpec, project: ProjectIndex) -> FunctionMetadata:
        matches = [
            function
            for function in project.functions
            if function.reference.path == specification.target.path
            and function.qualified_name == specification.qualified_name
        ]
        if len(matches) != 1:
            raise SpecificationError(
                "property target does not uniquely identify an indexed function"
            )
        function = matches[0]
        if function.is_method or "." in function.qualified_name:
            raise SpecificationError("Milestone 1 supports only top-level functions")
        if function.is_async:
            raise SpecificationError("async functions are not supported in Milestone 1")
        if specification.target.content_hash != function.reference.content_hash:
            raise SpecificationError("property target hash does not match the scanned source")
        if specification.target.start_line != function.reference.start_line:
            raise SpecificationError("property target line does not match the indexed function")

        parameters = {
            parameter.name: parameter
            for parameter in function.parameters
            if parameter.kind in {"positional", "keyword_only"}
        }
        unsupported = [
            parameter.name
            for parameter in function.parameters
            if parameter.kind in {"var_positional", "var_keyword"}
        ]
        if unsupported:
            raise SpecificationError(f"variadic parameters are unsupported: {unsupported}")
        argument_names = {argument.name for argument in specification.arguments}
        required = {name for name, parameter in parameters.items() if not parameter.has_default}
        if not required.issubset(argument_names) or not argument_names.issubset(parameters):
            raise SpecificationError(
                f"property arguments {sorted(argument_names)} do not match function parameters "
                f"{sorted(parameters)}"
            )
        for argument in specification.arguments:
            annotation = parameters[argument.name].annotation
            if annotation not in {"int", None}:
                raise SpecificationError(
                    f"integer strategy cannot be used for {argument.name}: {annotation}"
                )
        for constraint in specification.constraints:
            for operand in (constraint.left, constraint.right):
                if isinstance(operand, str) and operand not in argument_names:
                    raise SpecificationError(f"constraint references unknown argument: {operand}")
        oracle = specification.oracle
        if isinstance(oracle, ResultBoundOracle) and oracle.argument not in argument_names:
            raise SpecificationError(f"oracle references unknown argument: {oracle.argument}")
        if oracle.kind == "result_between_args" and (
            oracle.lower_argument not in argument_names
            or oracle.upper_argument not in argument_names
        ):
            raise SpecificationError("between oracle references an unknown argument")
        for evidence in specification.evidence:
            known = [
                candidate
                for candidate in project.functions
                if candidate.reference.path == evidence.path
                and candidate.reference.start_line == evidence.start_line
            ]
            if not known or evidence.content_hash != known[0].reference.content_hash:
                raise SpecificationError(
                    "property evidence is stale or not present in the project index"
                )
        return function

