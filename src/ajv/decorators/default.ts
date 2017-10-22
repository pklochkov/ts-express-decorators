

import {PropertyRegistry} from "../../jsonschema/registries/PropertyRegistry";
import {PropertyMetadata} from "../../jsonschema/class/PropertyMetadata";

export function Default(defaultValue: string | number | boolean | {}) {
    return PropertyRegistry.decorate((propertyMetadata: PropertyMetadata) => {
        propertyMetadata.schema.default = defaultValue;
    });
}