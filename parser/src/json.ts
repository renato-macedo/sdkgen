import {
  ArrayType,
  AstRoot,
  DescriptionAnnotation,
  EnumType,
  EnumValue,
  Field,
  FunctionOperation,
  GenericTypeDefinition,
  GenericTypeReference,
  HiddenAnnotation,
  Operation,
  OptionalType,
  RestAnnotation,
  StructType,
  ThrowsAnnotation,
  Type,
  TypeDefinition,
  TypeReference,
} from "./ast";
import { analyse } from "./semantic/analyser";
import { primitiveToAstClass } from "./utils";

interface StructTypes {
  [t: string]: {
    fields: {
      [name: string]: TypeDescription;
    };

    typeArgs: string[];
  };
}

interface EnumTypes {
  [t: string]: string[];
}
interface TypeTable {
  structTypes: StructTypes;
  enumTypes: EnumTypes;
}

interface FunctionTable {
  [name: string]: {
    args: {
      [arg: string]: TypeDescription;
    };
    ret: TypeDescription;
  };
}

export type TypeDescription = string | string[] | { [name: string]: TypeDescription };

interface AnnotationJson {
  type: string;
  value: any;
}

export interface AstJson {
  typeTable: any;
  functionTable: FunctionTable;
  errors: string[];
  annotations: { [target: string]: AnnotationJson[] };
}

export function astToJson(ast: AstRoot): AstJson {
  const annotations: { [target: string]: AnnotationJson[] } = {};
  const enumTypes: EnumTypes = {};
  const structTypes: StructTypes = {};

  for (const { name, fields } of ast.structTypes) {
    const genericTypeDef = ast.typeDefinitions.find(typedef => typedef.name === name);

    structTypes[name] = {
      fields: {},
      typeArgs: genericTypeDef instanceof GenericTypeDefinition ? genericTypeDef.typeArgs.map(t => t.name) : [],
    };

    const obj = structTypes[name].fields;

    for (const field of fields) {
      obj[field.name] = field.type.name;

      for (const ann of field.annotations) {
        if (ann instanceof DescriptionAnnotation) {
          const target = `type.${name}.${field.name}`;

          annotations[target] ||= [];
          const list = annotations[target];

          list.push({ type: "description", value: ann.text });
        }
      }
    }
  }

  for (const { name, values } of ast.enumTypes) {
    enumTypes[name] = values.map(v => v.value);
  }

  const typeTable: TypeTable = { enumTypes, structTypes };

  const functionTable: FunctionTable = {};

  for (const op of ast.operations) {
    const args: any = {};

    for (const arg of op.args) {
      args[arg.name] = arg.type.name;
      for (const ann of arg.annotations) {
        if (ann instanceof DescriptionAnnotation) {
          const target = `fn.${op.prettyName}.${arg.name}`;

          annotations[target] ||= [];
          const list = annotations[target];

          list.push({ type: "description", value: ann.text });
        }
      }
    }

    functionTable[op.prettyName] = {
      args,
      ret: {
        type: op.returnType.name,
        typeArgs: op.returnType instanceof GenericTypeReference ? op.returnType.typeArgs.map(t => t.name) : [],
      },
    };

    for (const ann of op.annotations) {
      const target = `fn.${op.prettyName}`;

      annotations[target] ||= [];
      const list = annotations[target];

      if (ann instanceof DescriptionAnnotation) {
        list.push({ type: "description", value: ann.text });
      }

      if (ann instanceof ThrowsAnnotation) {
        list.push({ type: "throws", value: ann.error });
      }

      if (ann instanceof RestAnnotation) {
        list.push({
          type: "rest",
          value: {
            bodyVariable: ann.bodyVariable,
            headers: [...ann.headers.entries()],
            method: ann.method,
            path: ann.path,
            pathVariables: ann.pathVariables,
            queryVariables: ann.queryVariables,
          },
        });
      }

      if (ann instanceof HiddenAnnotation) {
        list.push({ type: "hidden", value: null });
      }
    }
  }

  const { errors } = ast;

  return {
    annotations,
    errors,
    functionTable,
    typeTable,
  };
}

export function jsonToAst(json: AstJson): AstRoot {
  const operations: Operation[] = [];
  const typeDefinition: TypeDefinition[] = [];
  const errors: string[] = json.errors || [];

  function processEnumTypes(description: string[]) {
    return new EnumType(description.map(v => new EnumValue(v)));
  }

  function processType(description: TypeDescription, typeName?: string): Type {
    if (typeof description === "string") {
      const primitiveClass = primitiveToAstClass.get(description);

      if (primitiveClass) {
        return new primitiveClass();
      } else if (description.endsWith("?")) {
        return new OptionalType(processType(description.slice(0, description.length - 1)));
      } else if (description.endsWith("[]")) {
        return new ArrayType(processType(description.slice(0, description.length - 2)));
      }

      // Maybe generic type reference ?
      return new TypeReference(description);
    } else if (Array.isArray(description)) {
      return processEnumTypes(description);
    }

    const fields: Field[] = [];

    for (const fieldName of Object.keys(description)) {
      const field = new Field(fieldName, processType(description[fieldName]));

      if (typeName) {
        const target = `type.${typeName}.${fieldName}`;

        for (const annotationJson of json.annotations[target] || []) {
          if (annotationJson.type === "description") {
            field.annotations.push(new DescriptionAnnotation(annotationJson.value));
          }
        }
      }

      fields.push(field);
    }

    return new StructType(fields, []);
  }

  const { enumTypes, structTypes } = json.typeTable;

  for (const [typeName, description] of Object.entries(structTypes)) {
    const type = processType((description as any).fields as TypeDescription, typeName);

    typeDefinition.push(new TypeDefinition(typeName, type));
  }

  for (const [typeName, description] of Object.entries(enumTypes)) {
    const type = processEnumTypes(description as string[]);

    if (typeName === "ErrorType") {
      errors.push(...type.values.map(v => v.value));
      continue;
    }

    typeDefinition.push(new TypeDefinition(typeName, type));
  }

  for (const [functionName, func] of Object.entries(json.functionTable)) {
    const args = Object.keys(func.args).map(argName => {
      const field = new Field(argName, processType(func.args[argName]));
      const target = `fn.${functionName}.${argName}`;

      for (const annotationJson of json.annotations[target] || []) {
        if (annotationJson.type === "description") {
          field.annotations.push(new DescriptionAnnotation(annotationJson.value));
        }
      }

      return field;
    });

    const op = new FunctionOperation(functionName, args, processType(func.ret));
    const target = `fn.${functionName}`;

    for (const annotationJson of json.annotations[target] || []) {
      if (annotationJson.type === "description") {
        op.annotations.push(new DescriptionAnnotation(annotationJson.value));
      } else if (annotationJson.type === "throws") {
        op.annotations.push(new ThrowsAnnotation(annotationJson.value));
      } else if (annotationJson.type === "rest") {
        const { method, path, pathVariables, queryVariables, headers, bodyVariable } = annotationJson.value;

        op.annotations.push(new RestAnnotation(method, path, pathVariables, queryVariables, new Map(headers), bodyVariable));
      } else if (annotationJson.type === "hidden") {
        op.annotations.push(new HiddenAnnotation());
      }
    }

    operations.push(op);
  }

  const ast = new AstRoot(typeDefinition, operations, [...new Set(errors)]);

  analyse(ast);
  return ast;
}
