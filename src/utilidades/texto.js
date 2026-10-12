// "Panadería Doña Rosa" → "panaderia-dona-rosa"
export const slugificar = (texto) =>
    texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50) || 'empresa'
