/**
 * Como `Promise.all`, mas aguarda um item de cada vez. Para consultas dentro da MESMA transação: o `pg` não
 * roda duas consultas ao mesmo tempo na mesma conexão (hoje enfileira com aviso de descontinuado; o pg@9
 * vai recusar). As consultas do Drizzle só rodam ao serem aguardadas, então aqui elas vão em ordem.
 */
export async function emOrdem<T extends readonly unknown[] | []>(items: T): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const out: unknown[] = []
  for (const item of items) out.push(await item)
  return out as { -readonly [K in keyof T]: Awaited<T[K]> }
}
