import {PropertyMetadata} from "../../jsonschema/class/PropertyMetadata";
import {PropertyRegistry} from "../../jsonschema/registries/PropertyRegistry";

export function Enum(...enumValue: Array<string | number | boolean | {}>) {
    return PropertyRegistry.decorate((propertyMetadata: PropertyMetadata) => {
        propertyMetadata.schema.enum = [].concat((propertyMetadata.schema.enum || []) as any, enumValue as any);
    });
}