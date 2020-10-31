import { AstNode, Field, GenericType, GenericTypeDefinition, TypeDefinition, TypeReference } from "../ast";
import { SemanticError } from "./analyser";
import { Visitor } from "./visitor";

export class MatchTypeDefinitionsVisitor extends Visitor {
  visit(node: AstNode, typeDefinitions: TypeDefinition[]): void {
    if (node instanceof GenericTypeDefinition) {
      const argTypeDef = node.typeArgs.map(arg => new TypeDefinition(arg.name, new GenericType(arg.name)));
      const nodeTypeDefs = [...typeDefinitions, ...argTypeDef];

      super.visit(node.type, nodeTypeDefs);
      return;
    }

    if (node instanceof TypeReference) {
      const definition = typeDefinitions.find(t => t.name === node.name);

      if (definition === undefined) {
        throw new SemanticError(`Could not find type '${node.name}' at ${node.location}`);
      }

      node.type = definition.type;
      super.visit(node, typeDefinitions);
      return;
    }

    if (node instanceof Field) {
      super.visit(node, typeDefinitions);
      return;
    }

    super.visit(node, typeDefinitions);
  }
}
