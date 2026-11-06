import { OrmClient, CallFunction, CloudBaseInstance } from '../types';
export declare const generateClientByDataSourceName: (dataSourceName: string, callFunction: CallFunction, cloud?: CloudBaseInstance) => OrmClient;
export declare const generateClient: (callFunction: CallFunction, cloud?: CloudBaseInstance) => OrmClient;
