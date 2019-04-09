import { Observable } from 'rxjs'
import { ajax, AjaxRequest, AjaxResponse } from 'rxjs/ajax'
import { catchError, map } from 'rxjs/operators'
import { Omit } from 'utility-types'
import { createAggregateError, normalizeAjaxError } from '../util/errors'
import * as GQL from './schema'
export const graphQLContent = Symbol('graphQLContent')
export interface GraphQLDocument {
    [graphQLContent]: string
}

/**
 * Use this template string tag for all GraphQL queries.
 */
export const gql = (template: TemplateStringsArray, ...substitutions: any[]): GraphQLDocument => ({
    [graphQLContent]: String.raw(template, ...substitutions.map(s => s[graphQLContent] || s)),
})

export interface SuccessGraphQLResult<T extends GQL.IQuery | GQL.IMutation> {
    data: T
    errors: undefined
}
export interface ErrorGraphQLResult {
    data: undefined
    errors: GQL.IGraphQLResponseError[]
}

export type GraphQLResult<T extends GQL.IQuery | GQL.IMutation> = SuccessGraphQLResult<T> | ErrorGraphQLResult

/**
 * Guarantees that the GraphQL query resulted in an error.
 */
export function isGraphQLError<T extends GQL.IQuery | GQL.IMutation>(
    result: GraphQLResult<T>
): result is ErrorGraphQLResult {
    return !!(result as ErrorGraphQLResult).errors && (result as ErrorGraphQLResult).errors.length > 0
}

export function dataOrThrowErrors<T extends GQL.IQuery | GQL.IMutation>(result: GraphQLResult<T>): T {
    if (isGraphQLError(result)) {
        throw createAggregateError(result.errors)
    }
    return result.data
}

export interface GraphQLError extends Error {
    queryName: string
}
export const createInvalidGraphQLQueryResponseError = (queryName: string): GraphQLError =>
    Object.assign(new Error(`Invalid GraphQL response: query ${queryName}`), {
        queryName,
    })
export const createInvalidGraphQLMutationResponseError = (queryName: string): GraphQLError =>
    Object.assign(new Error(`Invalid GraphQL response: mutation ${queryName}`), {
        queryName,
    })

export interface GraphQLRequestOptions {
    headers: AjaxRequest['headers']
    requestOptions?: Partial<Omit<AjaxRequest, 'url' | 'method' | 'headers' | 'body'>>
    baseUrl?: string
}

export function requestGraphQL<R extends GQL.IGraphQLResponseRoot>({
    request,
    variables,
    headers,
    requestOptions = {},
    baseUrl = '',
}: GraphQLRequestOptions & {
    request: GraphQLDocument
    variables: any
}): Observable<R> {
    const nameMatch = request[graphQLContent].match(/^\s*(?:query|mutation)\s+(\w+)/)
    return ajax({
        method: 'POST',
        url: `${baseUrl}/.api/graphql${nameMatch ? '?' + nameMatch[1] : ''}`,
        headers,
        body: JSON.stringify({ query: request[graphQLContent], variables }),
        ...requestOptions,
    }).pipe(
        catchError<AjaxResponse, never>(err => {
            normalizeAjaxError(err)
            throw err
        }),
        map(({ response }) => response)
    )
}
