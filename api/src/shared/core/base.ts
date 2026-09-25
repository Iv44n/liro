declare global {
  type Id = string
}

export const Id = {
  generate: (): Id => Bun.randomUUIDv7()
}
