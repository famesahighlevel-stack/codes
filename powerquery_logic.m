let
    // ==========================================
    // CONFIGURACIÓN DE FREELANCERS
    // ==========================================
    // Aquí puedes agregar o quitar vendedores (en MAYÚSCULAS) y definir hasta qué fecha son considerados "Freelance".
    // Si alguien deja de ser freelance, simplemente ajusta su fecha de "VigenteHasta".
    ConfigFreelance = Table.FromRecords({
        [Vendedor = "YESSICA ALEJANDRA CARRERA PINEDA", VigenteHasta = #date(2099, 12, 31)],
        [Vendedor = "WALTER NEHEMIAS GUERRA", VigenteHasta = #date(2099, 12, 31)],
        [Vendedor = "ELIDA MARIBEL AQUINO", VigenteHasta = #date(2099, 12, 31)],
        [Vendedor = "YARELIN BARRAZA ARIAS", VigenteHasta = #date(2025, 10, 31)],
        [Vendedor = "YENDY MIREYA CUMAR CASTRO", VigenteHasta = #date(2025, 10, 31)],
        [Vendedor = "YOSELIN EUFEMIA BARRAZA ARIAS", VigenteHasta = #date(2025, 10, 31)]
    }),

    // Origen de datos
    Origen = Csv.Document(Web.Contents("https://docs.google.com/spreadsheets/d/18hu78kNliMjACGLusinE20YjotxhNRw1IBDgupKj_x8/gviz/tq?tqx=out:csv&sheet=Hoja1"),[Delimiter=",", Columns=7, Encoding=65001]),
    #"Encabezados promovidos" = Table.PromoteHeaders(Origen, [PromoteAllScalars=true]),
    #"Tipo cambiado" = Table.TransformColumnTypes(#"Encabezados promovidos",{{"Contact Id", type text}, {"Fecha", type date}, {"Assigned", type text}, {"Secuencia", type text}, {"Anuncio", type text}, {"MES", Int64.Type}, {"CLAVE", type text}}),
    #"Texto limpio" = Table.TransformColumns(#"Tipo cambiado",{{"Assigned", Text.Clean, type text}, {"Secuencia", Text.Clean, type text}, {"Anuncio", Text.Clean, type text}, {"CLAVE", Text.Clean, type text}}),
    #"Texto en mayúsculas" = Table.TransformColumns(#"Texto limpio",{{"Assigned", Text.Upper, type text}, {"Secuencia", Text.Upper, type text}, {"Anuncio", Text.Upper, type text}, {"CLAVE", Text.Upper, type text}}),
    #"Columnas renombradas" = Table.RenameColumns(
        #"Texto en mayúsculas",
        {
            {"Anuncio", "Anuncio1"},
            {"Fecha", "FECHA"}
        }
    ),

    // ==========================================
    // RANKING DE ANUNCIOS (Por Día y Secuencia)
    // ==========================================
    #"Filas con Anuncio" = Table.SelectRows(
        #"Columnas renombradas",
        each [Anuncio1] <> null and [Anuncio1] <> ""
    ),

    #"Agrupar para conteo" = Table.Group(
        #"Filas con Anuncio",
        {"FECHA", "Secuencia", "Anuncio1"},
        {{"CntAnun", each Table.RowCount(_), Int64.Type}}
    ),

    #"Ordenar frecuencia descendente" = Table.Sort(
        #"Agrupar para conteo",
        {
            {"FECHA", Order.Ascending},
            {"Secuencia", Order.Ascending},
            {"CntAnun", Order.Descending}
        }
    ),

    #"Agregar índice para ranking" = Table.Group(
        #"Ordenar frecuencia descendente",
        {"FECHA", "Secuencia"},
        {
            {
                "Data",
                each Table.AddIndexColumn(_, "Index", 1, 1, Int64.Type),
                type table
            }
        }
    ),

    #"Expandir tabla ranking" = Table.ExpandTableColumn(
        #"Agregar índice para ranking",
        "Data",
        {"Anuncio1", "Index"}
    ),

    // Filtramos solo los 3 anuncios más importantes por cada día/secuencia
    #"Filtro Top 3" = Table.SelectRows(#"Expandir tabla ranking", each ([Index] <= 3)),

    #"Tipo cambiado índice a texto" = Table.TransformColumnTypes(
        #"Filtro Top 3",
        {{"Index", type text}}
    ),

    #"Pivotear para Ranking" = Table.Pivot(
        #"Tipo cambiado índice a texto",
        List.Distinct(#"Tipo cambiado índice a texto"[Index]),
        "Index",
        "Anuncio1",
        List.Min
    ),

    #"Renombrar a Ranking" = Table.RenameColumns(
        #"Pivotear para Ranking",
        {
            {"1", "Ranking1"},
            {"2", "Ranking2"},
            {"3", "Ranking3"}
        }
    ),

    // ==========================================
    // IDENTIFICACIÓN DE FREELANCERS VIGENTES
    // ==========================================
    #"Marcar EsFreelance" = Table.AddColumn(#"Columnas renombradas", "EsFreelance", each
        let
            v = [Assigned],
            f = [FECHA]
        in
            if v = null then false
            else not Table.IsEmpty(Table.SelectRows(ConfigFreelance, each [Vendedor] = v and [VigenteHasta] >= f))
    , type logical),

    // ==========================================
    // ASIGNACIÓN ROTATIVA (Ranking 1, 2, 3...)
    // ==========================================
    #"Agregar VacíoFlag" = Table.AddColumn(
        #"Marcar EsFreelance",
        "IsVacío",
        each if ([Anuncio1] = null or [Anuncio1] = "") then 1 else 0,
        Int64.Type
    ),

    #"Vacíos con índice" = Table.Group(
        #"Agregar VacíoFlag",
        {"FECHA", "Secuencia"},
        {
            {
                "Data",
                each
                    let
                        tbl = _,
                        Vacíos = Table.SelectRows(tbl, each [IsVacío] = 1),
                        NoVacíos = Table.SelectRows(tbl, each [IsVacío] = 0),
                        // Solo asignamos índice de fila (1, 2, 3...) a los vacíos para la rotación del ranking
                        VacíosConIndice = Table.AddIndexColumn(Vacíos, "VacíoFila", 1, 1, Int64.Type)
                    in
                        Table.Combine({NoVacíos, VacíosConIndice}),
                type table
            }
        }
    ),

    #"Expandir tabla final" = Table.ExpandTableColumn(
        #"Vacíos con índice",
        "Data",
        {"Contact Id", "Assigned", "Anuncio1", "CLAVE", "IsVacío", "VacíoFila", "EsFreelance"}
    ),

    #"Merge con Rankings" = Table.NestedJoin(
        #"Expandir tabla final",
        {"FECHA", "Secuencia"},
        #"Renombrar a Ranking",
        {"FECHA", "Secuencia"},
        "Rankings",
        JoinKind.LeftOuter
    ),

    #"Expandir Rankings" = Table.ExpandTableColumn(
        #"Merge con Rankings",
        "Rankings",
        {"Ranking1", "Ranking2", "Ranking3"}
    ),

    // ==========================================
    // ASIGNACIÓN FINAL DE ANUNCIO (AnuncioF)
    // ==========================================
    #"Agregar AnuncioF" = Table.AddColumn(
        #"Expandir Rankings",
        "AnuncioF",
        each
            let
                anuncioOriginal = [Anuncio1],
                rankings = List.RemoveNulls({[Ranking1], [Ranking2], [Ranking3]}),
                esFreelance = [EsFreelance],
                idx =
                    if [VacíoFila] <> null and List.Count(rankings) > 0
                    then Number.Mod([VacíoFila] - 1, List.Count(rankings)) + 1
                    else null
            in
                if anuncioOriginal <> null and anuncioOriginal <> "" then
                    anuncioOriginal
                else if esFreelance then
                    null
                else if idx <> null then
                    rankings{idx - 1}
                else
                    null,
        type text
    ),

    // ==========================================
    // LÓGICA DE COLUMNA PAGINA
    // ==========================================
    #"Agregar Pagina" = Table.AddColumn(
        #"Agregar AnuncioF",
        "Pagina",
        each
            if ([Secuencia] = null or [Secuencia] = "") then
                "SIN SECUENCIA"
            else if ([AnuncioF] = null or [AnuncioF] = "") then
                if [EsFreelance] then "FREELANCE" else "SIN CODIGO"
            else if [Secuencia] = "R3.2" then "Boom Hogar"
            else if [Secuencia] = "R3.3" then "Muebles GT"
            else if [Secuencia] = "R1.1" then "Hogar GT"
            else if [Secuencia] = "R1.3" then "Roperos GT"
            else if [Secuencia] = "R2.1" then "Cómpralo"
            else if [Secuencia] = "R2.2" then "Mi Hogar Mueblero"
            else "LA MUEBLERIA."
    ),

    // Limpieza final de columnas auxiliares
    #"Quitar auxiliares" = Table.RemoveColumns(
        #"Agregar Pagina",
        {"IsVacío", "VacíoFila", "EsFreelance", "Ranking1", "Ranking2", "Ranking3", "Anuncio1"}
    )
in
    #"Quitar auxiliares"
