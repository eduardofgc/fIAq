import postgres from 'postgres'

// SSL: o postgres.js detecta o modo de SSL pela própria connection string.
//   - Postgres local (Docker): sem parâmetros extras
//     DATABASE_URL=postgresql://fiaq:fiaq123@localhost:5432/fiaq
//   - Bancos gerenciados (Neon, Supabase, Vercel Postgres): adicione ?sslmode=require
//     DATABASE_URL=postgresql://usuario:senha@host:5432/fiaq?sslmode=require
//
// max: 1 é o padrão recomendado para Vercel Functions (serverless):
// cada instância da função mantém no máximo 1 conexão aberta,
// que é encerrada após idle_timeout segundos de inatividade.
// Fora da Vercel (Coolify, Docker) um único processo atende todo mundo: com 1
// conexão, as buscas de cada pergunta e as perguntas de alunos diferentes
// esperam em fila. Lá usamos um pool pequeno.
//
// prepare: false mantém compatibilidade com poolers serverless, como o
// Transaction Pooler do Supabase, que não suporta prepared statements.
let sql: postgres.Sql | null = null

export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim())
}

export function getSql(): postgres.Sql {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString) {
    throw new Error('DATABASE_URL não definida. Verifique o .env ou as variáveis da Vercel.')
  }

  sql ??= postgres(connectionString, {
    max: process.env.VERCEL ? 1 : 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10
  })

  return sql
}

export default getSql
