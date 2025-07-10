# **App Name**: Gerenciador de Futevôlei

## Core Features:

- Configuração de Categoria: Gerenciar múltiplas categorias de torneio (ex: Masculino, Misto) com parâmetros customizáveis, como número de grupos, duplas, etc.
- Cadastro de Duplas: Cadastrar duplas com jogadores individuais que podem participar de múltiplas categorias.
- Geração e Gerenciamento de Grupos com IA: Ferramenta que distribui automaticamente as duplas nos grupos, balanceando a quantidade. Administradores podem reorganizar manualmente as duplas.
- Geração Automática de Horários: Alocar automaticamente os horários dos jogos, respeitando a disponibilidade das quadras e evitando conflitos entre jogadores.
- Geração Dinâmica de Playoffs: Gerar dinamicamente os playoffs com base nos resultados da fase de grupos, exibindo placeholders até que os resultados estejam disponíveis.
- Estatísticas e Classificação em Tempo Real: Calcular estatísticas (vitórias, pontos feitos, diferença de pontos) e atualizar as classificações em tempo real.
- Controle de Acesso: Firebase Auth para separar o acesso de administrador (editar placares, configurar torneios) e o acesso somente leitura.

## Style Guidelines:

- Um laranja vibrante (#FF8C00) para refletir a energia e a emoção do futevôlei de praia.
- Um bege muito claro (#F5F5DC), fornecendo um pano de fundo neutro para os elementos vibrantes.
- Um azul complementar (#4682B4) para destacar elementos interativos e informações importantes.
- Fonte 'Inter', uma sans-serif, para uma sensação moderna, neutra e legível.
- Usar ícones claros e consistentes para navegação, ações e para representar diferentes categorias ou estatísticas.
- Usar um layout responsivo, baseado em cards, para apresentar as informações de forma clara em todos os dispositivos.
- Transições e animações sutis para fornecer feedback e aprimorar o engajamento do usuário, como atualizar a tabela em tempo real ou ao pressionar o botão.