import { OrmClient, CallFunction, ModelFetch, CloudBaseInstance } from '../types';
export declare const enum EQUERY_PARAM_TYPE {
    ARRAY = "ARRAY",
    BOOLEAN = "BOOLEAN",
    NUMBER = "NUMBER",
    OBJECT = "OBJECT",
    STRING = "STRING"
}
export declare const generateHTTPClient: (callFunction: CallFunction, fetch: ModelFetch, baseUrl: string, options?: {
    sqlBaseUrl?: string;
    cloud?: CloudBaseInstance;
}) => OrmClient;
