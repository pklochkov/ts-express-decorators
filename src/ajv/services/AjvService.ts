import {OverrideService} from "../../di/services/overrideService";
import {ValidationService} from "../../mvc/services/ValidationService";

@OverrideService(ValidationService)
export class AjvService extends ValidationService {
    public validate(obj: any, targetType: any, baseType?: any): boolean {

        return false;
    }
}