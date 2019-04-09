import { Observable } from 'rxjs'
import { catchError, delay, filter, map, retryWhen } from 'rxjs/operators'
import { dataOrThrowErrors, gql } from '../../../../../shared/src/graphql/graphql'
import { memoizeObservable } from '../../../../../shared/src/util/memoizeObservable'
import { FileSpec, makeRepoURI, RepoSpec, ResolvedRevSpec } from '../../../../../shared/src/util/url'
import { CloneInProgressError, ECLONEINPROGESS, RepoNotFoundError, RevNotFoundError } from '../backend/errors'
import { queryGraphQL } from '../backend/graphql'

/**
 * @return Observable that emits the repo URL
 *         Errors with a `RepoNotFoundError` if the repo is not found
 */
export const resolveRepo = memoizeObservable(
    (ctx: { repoName: string }): Observable<string> =>
        queryGraphQL(
            gql`
                query ResolveRepo($repoName: String!) {
                    repository(name: $repoName) {
                        url
                    }
                }
            `,
            { ...ctx }
        ).pipe(
            map(dataOrThrowErrors),
            map(({ repository }) => {
                if (!repository) {
                    throw new RepoNotFoundError(ctx.repoName)
                }

                return repository.url
            }, catchError((err, caught) => caught))
        ),
    makeRepoURI
)

/**
 * @return Observable that emits the commit ID
 *         Errors with a `CloneInProgressError` if the repo is still being cloned.
 */
export const resolveRev = memoizeObservable(
    (ctx: { repoName: string; rev?: string }): Observable<string> =>
        queryGraphQL(
            gql`
                query ResolveRev($repoName: String!, $rev: String!) {
                    repository(name: $repoName) {
                        mirrorInfo {
                            cloneInProgress
                        }
                        commit(rev: $rev) {
                            oid
                        }
                    }
                }
            `,
            { ...ctx, rev: ctx.rev || '' }
        ).pipe(
            map(dataOrThrowErrors),
            map(({ repository }) => {
                if (!repository) {
                    throw new RepoNotFoundError(ctx.repoName)
                }
                if (repository.mirrorInfo.cloneInProgress) {
                    throw new CloneInProgressError(ctx.repoName)
                }
                if (!repository.commit) {
                    throw new RevNotFoundError(ctx.rev)
                }
                return repository.commit.oid
            })
        ),
    makeRepoURI
)

export function retryWhenCloneInProgressError<T>(): (v: Observable<T>) => Observable<T> {
    return (maybeErrors: Observable<T>) =>
        maybeErrors.pipe(
            retryWhen(errors =>
                errors.pipe(
                    filter(err => {
                        if (err.code === ECLONEINPROGESS) {
                            return true
                        }

                        // Don't swallow other errors.
                        throw err
                    }),
                    delay(1000)
                )
            )
        )
}

/**
 * Fetches the lines of a given file at a given commit from the Sourcegraph API.
 * Will return an empty array if the repo, commit or file does not exist or an error happened (TODO change this!).
 *
 * Only emits once.
 */
export const fetchBlobContentLines = memoizeObservable(
    (ctx: RepoSpec & ResolvedRevSpec & FileSpec): Observable<string[]> =>
        queryGraphQL(gql`
            query BlobContent($repoName: String!, $commitID: String!, $filePath: String!) {
                repository(name: $repoName) {
                    commit(rev: $commitID) {
                        file(path: $filePath) {
                            content
                        }
                    }
                }
            }
        `).pipe(
            map(dataOrThrowErrors),
            map(({ repository }) => {
                if (!repository || !repository.commit || !repository.commit.file || !repository.commit.file.content) {
                    return []
                }
                return repository.commit.file.content.split('\n')
            }),
            catchError(({ errors, ...rest }) => {
                if (errors && errors.length === 1) {
                    const err = errors[0]
                    const isFileContent = err.path.join('.') === 'repository.commit.file.content'
                    const isDNE = /does not exist/.test(err.message)

                    // The error is the file DNE. Just ignore it and pass an empty array
                    // to represent this.
                    if (isFileContent && isDNE) {
                        return []
                    }
                }

                // Don't swallow unexpected errors.
                throw { errors, ...rest }
            })
        ),
    makeRepoURI
)
