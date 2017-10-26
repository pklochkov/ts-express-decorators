/**
 * @module common/mvc
 */
/** */
import {$log} from "ts-log-debug";
import {ConverterService} from "../../converters/services/ConverterService";
import {CastError} from "../../core/errors/CastError";
import {Type} from "../../core/interfaces";
import {nameOf} from "../../core/utils";
import {InjectorService} from "../../di/services/InjectorService";
import {FilterService} from "../../filters/services/FilterService";
import {ParseExpressionError} from "../errors/ParseExpressionError";
import {RequiredParamError} from "../errors/RequiredParamError";
import {IHandlerScope} from "../interfaces/IHandlerScope";
import {ControllerRegistry} from "../registries/ControllerRegistry";
import {MiddlewareRegistry} from "../registries/MiddlewareRegistry";
import {RouterController} from "../services/RouterController";
import {ValidationService} from "../services/ValidationService";
import {EndpointMetadata} from "./EndpointMetadata";
import {HandlerMetadata} from "./HandlerMetadata";
import {ParamMetadata} from "../../filters/class/ParamMetadata";
import {ENDPOINT_INFO, RESPONSE_DATA} from "../../filters/constants";


/**
 * @stable
 */
export class HandlerBuilder {

    protected constructor(private handlerMetadata: HandlerMetadata) {
    }

    /**
     *
     * @param obj
     * @returns {HandlerBuilder}
     */
    static from(obj: any | EndpointMetadata) {
        if (obj instanceof EndpointMetadata) { // Endpoint
            return new HandlerBuilder(new HandlerMetadata(obj.target, obj.methodClassName));
        }
        // Middleware
        return new HandlerBuilder(new HandlerMetadata(obj));
    }

    /**
     *
     * @returns {any}
     */
    public build() {

        if (this.handlerMetadata.errorParam) {
            return (err: any, request: any, response: any, next: any) => {
                return this.invoke({err, request, response, next});
            };

        } else {
            return (request: any, response: any, next: any) => {
                return this.invoke({request, response, next});
            };
        }
    }

    /**
     *
     * @returns {any}
     */
    private middlewareHandler(): Function {
        const provider = MiddlewareRegistry.get(this.handlerMetadata.target);

        /* istanbul ignore next */
        if (!provider) {
            throw new Error("Middleware component not found in the MiddlewareRegistry");
        }

        return provider.instance.use.bind(provider.instance);
    }

    /**
     *
     * @param locals
     * @returns {any}
     */
    private endpointHandler = <T>(locals: Map<string | Function, any> = new Map<string | Function, any>()): Function => {

        const provider = ControllerRegistry.get(this.handlerMetadata.target);

        /* istanbul ignore next */
        if (!provider) {
            throw new Error("Controller component not found in the ControllerRegistry");
        }

        const target = provider.useClass;

        if (provider.scope || provider.instance === undefined) {

            if (!locals.has(RouterController)) {
                locals.set(RouterController, new RouterController(provider.router));
            }

            provider.instance = InjectorService.invoke<T>(target, locals);
        }

        return provider.instance[this.handlerMetadata.methodClassName!].bind(provider.instance);
    };

    /**
     *
     * @returns {any}
     */
    private get handler(): Function {
        switch (this.handlerMetadata.type) {
            default:
            case "function":
                return this.handlerMetadata.target;

            case "middleware":
                return this.middlewareHandler();

            case "controller":
                return this.endpointHandler();
        }
    }

    /**
     *
     * @param locals
     * @returns {Promise<TResult2|TResult1>}
     */
    public async invoke(locals: IHandlerScope): Promise<any> {

        const {next, request, response} = locals;
        let nextCalled = false;
        const target = this.handlerMetadata.target;
        const injectable = this.handlerMetadata.injectable;
        const methodName = this.handlerMetadata.methodClassName;

        const info = (o = {}) => JSON.stringify({
            type: this.handlerMetadata.type,
            target: (target ? nameOf(target) : target.name) || "anonymous",
            methodName,
            injectable,
            data: locals.request && locals.request.getStoredData ? locals.request.getStoredData() : undefined,
            ...o
        });

        locals.next = (error?: any) => {
            try {
                nextCalled = true;
                if (response.headersSent) {
                    // $log.debug(request.tagId, "[INVOKE][END  ]", info());
                    return;
                }

                /* istanbul ignore else */
                $log.debug(request.tagId, "[INVOKE][END  ]", info({error}));
                return next(error);
            } catch (er) {
                er.originalError = error;
                return next(er);
            }
        };

        try {
            if (request.tagId) {
                $log.debug(request.tagId, "[INVOKE][START]", info());
            }

            const parameters = this.localsToParams(locals);
            const result = await (this.handler)(...parameters);

            if (!nextCalled) {

                if (this.handlerMetadata.type !== "function" && result !== undefined) {
                    locals.request.storeData(result);
                }

                if (!this.handlerMetadata.nextFunction) {
                    locals.next();
                }
            }
        } catch (err) {
            locals.next(err);
        }
    }

    /**
     *
     * @param locals
     */
    private localsToParams(locals: IHandlerScope) {

        if (this.handlerMetadata.injectable) {
            return this.getInjectableParameters(locals);
        }

        let parameters: any[] = [locals.request, locals.response];

        if (this.handlerMetadata.errorParam) {
            parameters.unshift(locals.err);
        }

        if (this.handlerMetadata.nextFunction) {
            parameters.push(locals.next);
        }

        return parameters;
    }

    /**
     *
     * @param localScope
     * @returns {[(any|EndpointMetadata|any|any),(any|EndpointMetadata|any|any),(any|EndpointMetadata|any|any),(any|EndpointMetadata|any|any),(any|EndpointMetadata|any|any)]}
     */
    private getInjectableParameters = (localScope: IHandlerScope = {} as IHandlerScope): any[] => {
        const converterService = InjectorService.get<ConverterService>(ConverterService);
        const filterService = InjectorService.get<FilterService>(FilterService);
        const validationService = InjectorService.get<ValidationService>(ValidationService);

        return this.handlerMetadata
            .services
            .map((param: ParamMetadata, index: number) => {

                let paramValue;

                if (param.name in localScope) {
                    return localScope[param.name];
                }

                if (param.service === ENDPOINT_INFO) {
                    return localScope["request"].getEndpoint();
                }

                if (param.service === RESPONSE_DATA) {
                    return localScope["request"].getStoredData();
                }

                if (filterService.has(param.service as Type<any>)) {
                    paramValue = filterService.invokeMethod(
                        param.service as Type<any>,
                        param.expression,
                        localScope.request,
                        localScope.response
                    );
                }

                if (!param.isValidRequiredValue(paramValue)) {
                    throw new RequiredParamError(param.name, param.expression);
                }

                try {

                    if (param.useConverter) {
                        const type = param.type || param.collectionType;
                        paramValue = converterService.deserialize(paramValue, type, param.collectionType);

                        validationService.validate(paramValue, type, param.collectionType);
                    }

                } catch (err) {

                    /* istanbul ignore next */
                    if (err.name === "BAD_REQUEST") {
                        throw new ParseExpressionError(param.name, param.expression, err.message);
                    } else {
                        /* istanbul ignore next */
                        throw new CastError(err);
                    }
                }

                return paramValue;
            });
    };
}
