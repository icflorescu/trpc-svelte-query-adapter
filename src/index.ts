import DeepProxy from 'proxy-deep';

import type { TRPCClientErrorLike, CreateTRPCProxyClient } from '@trpc/client';
import type { AnyRouter } from '@trpc/server';

import {
	useQueryClient,
	createQuery,
	createMutation,
	createInfiniteQuery,
	createQueries,
	CreateQueryOptions,
	CreateMutationOptions,
	CreateInfiniteQueryOptions,
	InvalidateQueryFilters,
	FetchQueryOptions,
	FetchInfiniteQueryOptions,
	InfiniteData,
	RefetchQueryFilters,
	RefetchOptions,
	ResetOptions,
	CancelOptions,
	Updater,
	SetDataOptions,
	QueryClient,
} from '@tanstack/svelte-query';

import { onDestroy } from 'svelte';

// CREDIT: https://stackoverflow.com/a/63448246
type WithNevers<T, V> = { [K in keyof T]:
	Exclude<T[K], undefined> extends V ? never
	: T[K] extends Record<string, unknown> ? Without<T[K], V>
	: T[K]
}
type Without<T, V, I = WithNevers<T, V>> = Pick<I, { [K in keyof I]: I[K] extends never ? never : K }[keyof I]>

type HasQuery = { query: (...args: any[]) => any }
type HasMutate = { mutate: (...args: any[]) => any }
type HasSubscribe = { subscribe: (...args: any[]) => any }
type OnlyQueries<TClient> = Without<TClient, HasMutate | HasSubscribe>


// getQueryKey
type QueryType = 'query' | 'infinite' | 'any';

type QueryKey = [
	string[],
	{ input?: unknown; type?: Exclude<QueryType, 'any'> }?,
];

function getArrayQueryKey(
	queryKey: string | [string] | [string, ...unknown[]] | unknown[],
	input: unknown,
	type: QueryType,
): QueryKey {
	const arrayPath = (typeof queryKey === 'string' ?
		queryKey === '' ? [] : queryKey.split('.')
		: queryKey) as [string]

	if (!input && (!type || type === 'any'))
		// for `utils.invalidate()` to match all queries (including vanilla react-query)
		// we don't want nested array if path is empty, i.e. `[]` instead of `[[]]`
		return arrayPath.length ? [arrayPath] : ([] as unknown as QueryKey);

	return [
		arrayPath,
		{
			...(typeof input !== 'undefined' && { input: input }),
			...(type && type !== 'any' && { type: type }),
		},
	];
}

type GetQueryKey<TInput = undefined> = {
	getQueryKey:
	TInput extends undefined
	? () => QueryKey
	: (input: TInput, type?: QueryType) => QueryKey
}


// getContext
const ContextProcedureNames = {
	client: 'client',
	fetch: 'fetch',
	prefetch: 'prefetch',
	fetchInfinite: 'fetchInfinite',
	prefetchInfinite: 'prefetchInfinite',
	invalidate: 'invalidate',
	refetch: 'refetch',
	reset: 'reset',
	cancel: 'cancel',
	setData: 'setData',
	getData: 'getData',
	setInfiniteData: 'setInfiniteData',
	getInfiniteData: 'getInfiniteData',
} as const

type ContextProcedures<TInput = undefined, TOutput = undefined, TError = undefined> = {
	[ContextProcedureNames.fetch](input: TInput, opts?: FetchQueryOptions<TInput, TError, TOutput>): Promise<TOutput>
	[ContextProcedureNames.prefetch](input: TInput, opts?: FetchQueryOptions<TInput, TError, TOutput>): Promise<void>
	[ContextProcedureNames.fetchInfinite](input: TInput, opts?: FetchInfiniteQueryOptions<TInput, TError, TOutput>): Promise<InfiniteData<TOutput>>
	[ContextProcedureNames.prefetchInfinite](input: TInput, opts?: FetchInfiniteQueryOptions<TInput, TError, TOutput>): Promise<void>
	[ContextProcedureNames.invalidate](input?: TInput, filters?: InvalidateQueryFilters): Promise<void>
	[ContextProcedureNames.refetch](input?: TInput, filters?: RefetchQueryFilters, opts?: RefetchOptions): Promise<void>
	[ContextProcedureNames.reset](input?: TInput, opts?: ResetOptions): Promise<void>
	[ContextProcedureNames.cancel](input?: TInput, opts?: CancelOptions): Promise<void>
	[ContextProcedureNames.setData](input: TInput, updater: Updater<TOutput | undefined, TOutput | undefined>, opts?: SetDataOptions): void
	[ContextProcedureNames.getData](input?: TInput): TOutput | undefined
	[ContextProcedureNames.setInfiniteData](input: TInput, updater: Updater<InfiniteData<TOutput> | undefined, InfiniteData<TOutput> | undefined>, opts?: SetDataOptions): void
	[ContextProcedureNames.getInfiniteData](input?: TInput): InfiniteData<TOutput> | undefined
}

type AddContextPropTypes<TClient, TError> = {
	[K in keyof TClient]:
	TClient[K] extends HasQuery ? ContextProcedures<Parameters<TClient[K]['query']>[0], Awaited<ReturnType<TClient[K]['query']>>, TError>
	: AddContextPropTypes<TClient[K], TError> & Pick<ContextProcedures, typeof ContextProcedureNames.invalidate>
};

type UseContext<TClient, TError> = AddContextPropTypes<OnlyQueries<TClient>, TError>
	& Pick<ContextProcedures, typeof ContextProcedureNames.invalidate>
	& { [ContextProcedureNames.client]: TClient }


// useQueries
type CreateQueryOptionsForUseQueries<TInput, TError> =
	Omit<CreateQueryOptions<TInput, TError>, 'context'>

type UseQueriesRecord<TClient, TError> = { [K in keyof TClient]:
	TClient[K] extends HasQuery
	? (input: Parameters<TClient[K]['query']>[0], opts?: CreateQueryOptionsForUseQueries<Awaited<ReturnType<TClient[K]['query']>>, TError>)
		=> CreateQueryOptionsForUseQueries<Awaited<ReturnType<TClient[K]['query']>>, TError>
	: UseQueriesRecord<TClient[K], TError>
}

type UseQueries<TClient, TError> = <TOpts extends CreateQueryOptionsForUseQueries<any, any>[]>(
	queriesCallback: (t: UseQueriesRecord<OnlyQueries<TClient>, TError>) => readonly [...TOpts],
	context?: CreateQueryOptions['context']
) => ReturnType<typeof createQueries<TOpts>>


// Procedures
const ProcedureNames = {
	query: 'useQuery',
	infiniteQuery: 'useInfiniteQuery',
	mutate: 'useMutation',
	subscribe: 'useSubscription',
	queryKey: 'getQueryKey',
	context: 'useContext',
	queries: 'useQueries',
} as const

type UseQueryProcedure<TInput, TOutput, TError> = {
	[ProcedureNames.query]: (input: TInput, opts?: CreateQueryOptions<TOutput, TError>)
		=> ReturnType<typeof createQuery<TOutput, TError>>
}

type UseInfiniteQueryProcedure<TInput, TOutput, TError> = TInput extends { cursor?: any }
	? {
		[ProcedureNames.infiniteQuery]: (input: Omit<TInput, 'cursor'>, opts?: CreateInfiniteQueryOptions<TOutput, TError>)
			=> ReturnType<typeof createInfiniteQuery<TOutput, TError>>
	}
	: {}

type QueryProcedures<TInput, TOutput, TError> = UseQueryProcedure<TInput, TOutput, TError> & UseInfiniteQueryProcedure<TInput, TOutput, TError> & GetQueryKey<TInput>

type UseMutationProcedure<TInput, TOutput, TError, TContext = unknown> = {
	[ProcedureNames.mutate]: (opts?: CreateMutationOptions<TOutput, TError, TInput, TContext>)
		=> ReturnType<typeof createMutation<TOutput, TError, TInput, TContext>>
}

type UseTRPCSubscriptionOptions<TOutput, TError> = {
	enabled?: boolean
	onStarted?: () => void
	onData: (data: TOutput) => void
	onError?: (err: TError) => void
}

type GetSubscriptionOutput<TOpts> = TOpts extends unknown & Partial<infer A>
	? A extends { onData: any }
	? Parameters<A['onData']>[0] : never
	: never

type UseSubscriptionProcedure<TInput, TOutput, TError> = {
	[ProcedureNames.subscribe]: (input: TInput, opts?: UseTRPCSubscriptionOptions<TOutput, TError>)
		=> void
}

type AddQueryPropTypes<TClient, TError> = TClient extends Record<any, any> ? {
	[K in keyof TClient]:
	TClient[K] extends HasQuery ? QueryProcedures<Parameters<TClient[K]['query']>[0], Awaited<ReturnType<TClient[K]['query']>>, TError>
	: TClient[K] extends HasMutate ? UseMutationProcedure<Parameters<TClient[K]['mutate']>[0], Awaited<ReturnType<TClient[K]['mutate']>>, TError>
	: TClient[K] extends HasSubscribe ? UseSubscriptionProcedure<Parameters<TClient[K]['subscribe']>[0], GetSubscriptionOutput<Parameters<TClient[K]['subscribe']>[1]>, TError>
	: AddQueryPropTypes<TClient[K], TError> & GetQueryKey
} : TClient;

// Implementation
function useSubscription(cb: (...args: any[]) => any, input: any, opts: any) {
	const enabled = opts?.enabled ?? true;
	if (!enabled) return;

	let isStopped = false;
	const subscription = cb(input, {
		onStarted: () => {
			if (!isStopped) opts.onStarted?.();
		},
		onData: (data: any) => {
			if (!isStopped) opts.onData?.(data as any);
		},
		onError: (err: any) => {
			if (!isStopped) opts.onError?.(err);
		}
	})

	return onDestroy(() => {
		isStopped = true;
		subscription.unsubscribe();
	})
}

function createUseQueriesProxy(client: any) {
	return new DeepProxy({}, {
		get() {
			return this.nest(() => { })
		},
		apply(_target, _thisArg, argList) {
			const target = [...this.path].reduce((client, value) => client[value], client)
			const [input, opts] = argList

			return {
				...opts,
				queryKey: getArrayQueryKey(this.path, input, 'query'),
				queryFn: () => target.query(input),
			}
		}
	})
}

function createUseContextProxy(client: any, queryClient: QueryClient) {
	return new DeepProxy({}, {
		get(_target, key, _receiver) {
			if (key === ContextProcedureNames.client) return client;

			return this.nest(() => { })
		},

		apply(_target, _thisArg, argList) {
			const utilName = this.path.pop()

			// TODO: should probably replace `reduce` with `for...of` for better performance
			const target = [...this.path].reduce((client, value) => client[value], client) as any
			const [input, ...rest] = argList

			if (utilName === ContextProcedureNames.invalidate) {
				const [filters] = rest;

				return queryClient.invalidateQueries({
					...filters,
					queryKey: getArrayQueryKey(this.path, input, 'any')
				});
			} else if (utilName === ContextProcedureNames.fetch) {
				const [opts] = rest;

				return queryClient.fetchQuery({
					...opts,
					queryKey: getArrayQueryKey(this.path, input, 'query'),
					queryFn: () => target.query(input),
				});
			} else if (utilName === ContextProcedureNames.fetchInfinite) {
				const [opts] = rest;

				return queryClient.fetchInfiniteQuery({
					...opts,
					queryKey: getArrayQueryKey(this.path, input, 'infinite'),
					queryFn: ({ pageParam }) => target.query({ ...input, cursor: pageParam }),
				});
			} else if (utilName === ContextProcedureNames.prefetch) {
				const [opts] = rest;

				return queryClient.prefetchQuery({
					...opts,
					queryKey: getArrayQueryKey(this.path, input, 'query'),
					queryFn: () => target.query(input),
				});
			} else if (utilName === ContextProcedureNames.prefetchInfinite) {
				const [opts] = rest;

				return queryClient.prefetchInfiniteQuery({
					...opts,
					queryKey: getArrayQueryKey(this.path, input, 'infinite'),
					queryFn: ({ pageParam }) => target.query({ ...input, cursor: pageParam }),
				});
			} else if (utilName === ContextProcedureNames.refetch) {
				return queryClient.refetchQueries(
					getArrayQueryKey(this.path, input, 'any'),
					...rest
				);
			} else if (utilName === ContextProcedureNames.reset) {
				return queryClient.resetQueries(
					getArrayQueryKey(this.path, input, 'any'),
					...rest
				)
			} else if (utilName === ContextProcedureNames.cancel) {
				return queryClient.cancelQueries(
					getArrayQueryKey(this.path, input, 'any'),
					...rest
				)
			} else if (utilName === ContextProcedureNames.setData) {
				return queryClient.setQueryData(
					getArrayQueryKey(this.path, input, 'query'),
					...rest as [any]
				)
			} else if (utilName === ContextProcedureNames.getData) {
				return queryClient.getQueryData(
					getArrayQueryKey(this.path, input, 'query'),
					...rest
				)
			} else if (utilName === ContextProcedureNames.setInfiniteData) {
				return queryClient.setQueryData(
					getArrayQueryKey(this.path, input, 'infinite'),
					...rest as [any]
				)
			} else if (utilName === ContextProcedureNames.getInfiniteData) {
				return queryClient.getQueryData(
					getArrayQueryKey(this.path, input, 'infinite'),
					...rest
				)
			}

			// Just simulating the error thrown by `@trpc/react-query` for now.
			throw new TypeError('contextMap[utilName] is not a function');
		}
	})
}

export function svelteQueryWrapper<TRouter extends AnyRouter>(
	client: CreateTRPCProxyClient<TRouter>,
	queryClient?: QueryClient
) {
	type Client = typeof client;
	type RouterError = TRPCClientErrorLike<TRouter>;

	type ClientWithQuery = AddQueryPropTypes<Client, RouterError>;

	const useQueriesProxy = createUseQueriesProxy(client);

	return new DeepProxy({} as ClientWithQuery &
		(ClientWithQuery extends Record<any, any> ?
			{
				useContext(): UseContext<Client, RouterError>,
				useQueries: UseQueries<Client, RouterError>
			} : {}),
		{
			get() {
				return this.nest(() => { })
			},

			apply(_target, _thisArg, argList) {
				const procedure = this.path.pop()

				// TODO: should probably replace `reduce` with `for...of` for better performance
				const target = [...this.path].reduce((client, value) => client[value], client as Record<string, any>)
				const [input, opts] = argList

				// NOTE: should probably throw error for procedures
				// for procedures with conflicting names like `useQuery`,
				// `useMutation`, etc but it is not handled in `@trpc/react-query` either.
				if (procedure === ProcedureNames.query) {
					return createQuery({
						...opts,
						queryKey: getArrayQueryKey(this.path, input, 'query'),
						queryFn: () => target.query(input),
					})
				} else if (procedure === ProcedureNames.infiniteQuery) {
					return createInfiniteQuery({
						...opts,
						queryKey: getArrayQueryKey(this.path, input, 'infinite'),
						queryFn: ({ pageParam }) => target.query({ ...input, cursor: pageParam }),
					})
				} else if (procedure === ProcedureNames.mutate) {
					return createMutation({
						...opts,
						mutationKey: this.path,
						mutationFn: (data) => target.mutate(data),
					})
				} else if (procedure === ProcedureNames.subscribe) {
					return useSubscription(target.subscribe, input, opts)
				} else if (procedure === ProcedureNames.queryKey) {
					// NOTE: should probably throw error for procedures
					// like `useMutation` that don't have `getQueryKey`,
					// but it is not handled in `@trpc/react-query` either.
					return getArrayQueryKey(
						this.path,
						input,
						opts
					)
				} else if (procedure === ProcedureNames.queries) {
					if (this.path.length === 0) {
						return createQueries(input(useQueriesProxy));
					}
				} else if (procedure === ProcedureNames.context) {
					return createUseContextProxy(
						client,
						queryClient ? queryClient : useQueryClient()
					)
				}

				return target[procedure as string].call();
			}
		});
};
