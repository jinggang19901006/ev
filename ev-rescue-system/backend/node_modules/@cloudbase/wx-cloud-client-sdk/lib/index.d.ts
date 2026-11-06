import { CloudBaseInstance, ExtendedCloudBaseInstance, IMySqlOptions, IPgOptions, OrmClient } from './types';
import { generateHTTPClient } from './orm/http-orm-client';
import { MySqlClient } from './db/mysql';
import { PostgrestClient } from './db/postgrest';
import { Fetch } from './db/postgrest/types';
import type { CloudbaseAdapter } from '@cloudbase/adapter-interface';
export declare function initHTTPOverCallFunction(cloud: CloudBaseInstance, options?: {
    envId?: string;
    baseUrl?: string;
    sqlBaseUrl?: string;
    mysqlBaseUrl?: string;
}): ExtendedCloudBaseInstance;
export declare function init(cloud: CloudBaseInstance, options?: {
    envId?: string;
    adapter?: CloudbaseAdapter;
}): ExtendedCloudBaseInstance;
declare function generateMySQLClient(cloud: CloudBaseInstance, options?: {
    envId?: string;
    mysqlBaseUrl?: string;
    fetch?: Fetch;
}): (options?: IMySqlOptions) => MySqlClient<any, {}>;
declare function generatePGClient(cloud: CloudBaseInstance, options?: {
    envId?: string;
    pgBaseUrl?: string;
    fetch?: Fetch;
}): (clientOptions?: IPgOptions) => PostgrestClient<any, {
    PostgrestVersion: "12";
}, string, any>;
export * from './types';
export { generateHTTPClient, generateMySQLClient, generatePGClient };
declare const _default: {
    init: typeof init;
    generateHTTPClient: (callFunction: import("./types").CallFunction, fetch: (options: import("@cloudbase/adapter-interface").IFetchOptions) => any, baseUrl: string, options?: {
        sqlBaseUrl?: string | undefined;
        cloud?: CloudBaseInstance | undefined;
    } | undefined) => OrmClient;
    generateMySQLClient: typeof generateMySQLClient;
    generatePGClient: typeof generatePGClient;
};
export default _default;
