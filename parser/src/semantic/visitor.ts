import { ArrayType, AstNode, AstRoot, Field, Operation, OptionalType, StructType, TypeDefinition } from "../ast";

export abstract class Visitor {
  constructor(protected root: AstRoot) {}

  process(): void {
    for (const typeDefinition of this.root.typeDefinitions) {
      this.visit(typeDefinition, this.root.typeDefinitions);
    }

    for (const operation of this.root.operations) {
      this.visit(operation, this.root.typeDefinitions);
    }
  }

  visit(node: AstNode, typeDefinitions = this.root.typeDefinitions): void {
    if (node instanceof Operation) {
      for (const arg of node.args) {
        this.visit(arg, typeDefinitions);
      }

      this.visit(node.returnType, typeDefinitions);
    } else if (node instanceof Field || node instanceof TypeDefinition) {
      this.visit(node.type, typeDefinitions);
    } else if (node instanceof StructType) {
      for (const field of node.fields) {
        this.visit(field, typeDefinitions);
      }

      for (const spread of node.spreads) {
        this.visit(spread, typeDefinitions);
      }
    } else if (node instanceof ArrayType || node instanceof OptionalType) {
      this.visit(node.base, typeDefinitions);
    }
  }
}
