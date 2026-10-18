# Guild Monitor

[English](README.md) · **Português**

Um mod do [Claude Code](https://claude.com/claude-code) que transforma o monitor da sessão num pequeno RPG. Uma guilda de três personagens em pixel art vive num painel lateral (ou numa barra acima do prompt), trabalha enquanto o agente trabalha e sobe de nível conforme as tarefas são concluídas. Seus limites de uso, a janela de contexto e o custo aparecem como medidores de jogo.

> **Sem afiliação com a Anthropic.** O mascote laranja é uma homenagem de fã ao mascote do Claude Code. "Claude" e "Claude Code" são marcas da Anthropic.

<p align="center">
  <img src="docs/art/mago_design_preview16x.png" alt="Mago" width="160">
  <img src="docs/art/guerreiro_design_preview16x.png" alt="Guerreiro" width="160">
  <img src="docs/art/explorador_design_preview16x.png" alt="Explorador" width="160">
  <img src="docs/art/bug_design_preview16x.png" alt="Bug" width="160">
</p>

## O que faz

- **Três personagens, um para cada tipo de trabalho.** Quem está em cena acompanha o que o agente está *fazendo*, não o que você digitou.
- **Animados no terminal.** Sprites em tamanho cheio (32×16 células) desenhados com meio-bloco e truecolor, sem precisar de protocolo de imagem. Funciona no iTerm2, no foot e dentro do tmux.
- **Medidores** para o limite de 7 dias, o de 5 horas, a janela de contexto e o custo da sessão.
- **XP e nível por classe**, pagos por operação e guardados entre sessões.
- **Um bug** que aparece a cada chamada de ferramenta que falha e é derrotado quando ela volta a funcionar.

## A guilda

| Personagem | Faz | Entra em cena quando o agente… |
|---|---|---|
| **Mago** | planeja | está em modo plano ou organiza o trabalho (`TodoWrite`, `AskUserQuestion`, tarefas de plano, subagentes `Plan`) |
| **Guerreiro** | executa e corrige | altera coisas: `Edit`, `Write`, `MultiEdit`, comandos de shell que não são só leitura, outros subagentes |
| **Explorador** *(padrão)* | pesquisa e investiga | lê ou busca: `Read`, `Grep`, `Glob`, `WebSearch`, `WebFetch`, comandos de shell só de leitura, subagentes `Explore` |

Quem está em cena é a classe da maioria das **três últimas chamadas de ferramenta** (empate vai para a mais recente). Antes da primeira chamada do turno, o prompt dá um primeiro palpite ("corrija o bug" → Guerreiro, "planeje a feature" → Mago); sem nada a que se agarrar, é o Explorador.

### Estados

| Estado | Quando | Animação |
|---|---|---|
| trabalhando | há um turno em andamento | o personagem ativo trabalha |
| cansado | contexto ≥ 75% (configurável) | todos parecem exaustos |
| dormindo | 90 s sem atividade (configurável) | todos dormem |
| parado | nos demais casos | todos esperam, piscando |

<table align="center">
  <tr>
    <td align="center"><img src="docs/art/mago_trabalho_preview.gif" width="128"><br>Mago trabalhando</td>
    <td align="center"><img src="docs/art/guerreiro_trabalho_preview.gif" width="128"><br>Guerreiro trabalhando</td>
    <td align="center"><img src="docs/art/explorador_trabalho_preview.gif" width="128"><br>Explorador trabalhando</td>
    <td align="center"><img src="docs/art/bug_parado_preview.gif" width="128"><br>Bug</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/art/mago_parado_preview.gif" width="128"><br>Parado</td>
    <td align="center"><img src="docs/art/guerreiro_cansado_preview.gif" width="128"><br>Cansado</td>
    <td align="center"><img src="docs/art/explorador_dormindo_preview.gif" width="128"><br>Dormindo</td>
    <td align="center"><img src="docs/art/bug_derrotado_preview.gif" width="128"><br>Derrotado</td>
  </tr>
</table>

## Medidores

| Medidor | Mostra | Cor |
|---|---|---|
| **HP** | o que resta da janela de uso de 7 dias | verde acima de 50%, amarelo de 25% a 50%, vermelho abaixo de 25% |
| **MP** | o que resta da janela de 5 horas, com o tempo até ela reiniciar | azul |
| **ST** (stamina) | o que resta da janela de contexto | laranja |
| **Ouro** | quanto a sessão custou, em USD | dourado |
| **XP** | progresso até o próximo nível do personagem ativo | roxo |

HP e MP vêm dos limites da sua assinatura: fora de uma assinatura (por exemplo, com chave de API) mostram `--`. Um valor que a sessão ainda não informou mantém o último conhecido, então os medidores nunca se apagam ao trocar de personagem.

## XP e níveis

Cada chamada de ferramenta que termina **sem erro** paga XP na hora à classe a que pertence, então uma tarefa que explora, planeja e depois executa alimenta os três personagens:

```
XP da operação = 2  +  min(segundos / 2, 4)  +  min(linhas escritas / 20, 4)      (no máximo 10)
```

- O tempo é quanto a chamada durou. As linhas são o que uma edição ou um arquivo novo escreveu.
- Derrotar um bug paga **+10** à classe que fez a chamada que passou.
- Um turno que termina com uma resposta paga **+3** à classe ativa.
- Turnos interrompidos mantêm o que já foi pago.

O nível `n` começa em `40 × (n − 1)²` de XP: nível 2 com 40, nível 3 com 160, nível 4 com 360, nível 5 com 640. O XP fica salvo no armazenamento do plugin (`guild.v1`) e sobrevive a reinícios. Um aviso anuncia cada nível novo.

## O bug

Quando uma chamada de ferramenta falha, o bug aparece embaixo dos status do personagem ativo. Uma chamada bem-sucedida **do mesmo tipo** depois dele o derrota (em comandos de shell, o mesmo programa e subcomando: `npm test`, `git push`; nas demais ferramentas, a mesma ferramenta). Chamadas recusadas por permissão ou por um hook não contam como falha.

## Painel lateral

Num terminal largo, no layout de tela cheia do Claude Code (`/tui fullscreen`, 110 colunas ou mais), a guilda abre como um **painel à esquerda da conversa**:

- o personagem ativo em tamanho cheio, com os status **ao lado**, e o bug logo embaixo dos status quando uma chamada de ferramenta falha;
- os outros dois personagens embaixo, e a lista das **últimas pagas de XP** (`3min Guerreiro +6 Edit`);
- a largura é sua: arraste a borda do painel e o layout acompanha (os status descem para baixo do personagem quando estreito, depois o personagem encolhe);
- o **×** no canto do painel fecha e traz a barra inferior de volta; `/guild panel` abre de novo.

Ele abre sozinho a partir de 144 colunas (110 depois que você mesmo o abriu), a não ser que você o tenha fechado: a escolha fica guardada. Onde não há espaço (terminal estreito ou o layout clássico, sem tela cheia), a guilda continua como a barra acima do prompt, então nunca fica sem guilda.

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-explorador.png" alt="Explorador" width="280"><br>Explorador</td>
    <td align="center"><img src="docs/screenshots/panel-mago.png" alt="Mago" width="280"><br>Mago</td>
    <td align="center"><img src="docs/screenshots/panel-guerreiro.png" alt="Guerreiro" width="280"><br>Guerreiro</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/panel-bug.png" alt="Bug" width="280"><br>Bug</td>
    <td align="center"><img src="docs/screenshots/panel-cansado.png" alt="Cansado" width="280"><br>Cansado</td>
    <td align="center"><img src="docs/screenshots/panel-dormindo.png" alt="Dormindo" width="280"><br>Dormindo</td>
  </tr>
</table>

| Comando | Faz |
|---|---|
| `/guild panel` | abre o painel lateral e passa a abri-lo sempre |
| `/guild bar` | fecha o painel e volta à barra inferior |
| `/guild trace [N\|clear]` | mostra o registro das últimas N chamadas de ferramenta (padrão 20): quem estava em cena, quem ganhou o XP e um resumo; `clear` apaga. Só nomes de ferramenta, classes e o nome do programa de um comando de shell são guardados, nunca prompts, caminhos, argumentos nem variáveis |
| `/guild <cena>` | mostra uma cena de demonstração (`explorador`, `mago`, `guerreiro`, `bug`, `cansado`, `dormindo`); `/guild off` volta à sessão real |

## Requisitos

- Claude Code com suporte a mods. Desenvolvido e testado na **2.1.302**.
- Terminal com truecolor. Testado no **iTerm2** (macOS) e no **foot** (Linux), com e sem **tmux** (use `set -ga terminal-features ",*:RGB"` ou `Tc` se as cores ficarem apagadas).
- Para o painel lateral: o layout de tela cheia (`/tui fullscreen`) e 110 colunas ou mais. Para a barra inferior: 16 linhas livres acima do prompt (a reduzida usa 8).

## Instalação

Escolha uma.

**1. Pelo marketplace deste repositório**

```sh
claude plugin marketplace add viniciusilveira/guild-monitor
claude plugin install guild-monitor@guild-monitor
```

**2. A partir de um clone, para uma sessão**

```sh
git clone https://github.com/viniciusilveira/guild-monitor.git
claude --plugin-dir ./guild-monitor
```

**3. A partir de um clone, para todas as sessões**

```sh
export CLAUDE_CODE_PLUGIN_DIRS="$HOME/guild-monitor"
```

Reinicie o Claude Code e a guilda aparece acima do prompt.

## Configuração

| Opção | Padrão | O que faz |
|---|---|---|
| `sleepAfterSeconds` | `90` | tempo ocioso depois do qual a guilda dorme |
| `tiredAtPercent` | `75` | preenchimento do contexto em que todos ficam cansados |
| `bandSize` | `full` | `full`: personagem ativo em tamanho cheio (16 linhas); `compact`: todos reduzidos (8 linhas) |
| `layout` | `auto` | `auto`: painel lateral onde couber, barra inferior no resto; `bar`: só a barra; `panel`: só o painel |
| `demo` | `off` | uma cena fixa com valores fictícios: `explorador`, `mago`, `guerreiro`, `bug`, `cansado`, `dormindo` |

Defina-as na instalação (`claude plugin install … --config bandSize=compact`), com `claude plugin configure guild-monitor` ou em `/plugin`.

A banda se adapta ao terminal: primeiro o personagem ativo, depois os status ao lado, depois os outros dois personagens. Ela se esconde quando nem o personagem ativo cabe.

### Modo demo

O `demo` mostra números inventados (HP 72%, MP 45% com 2h13 para reiniciar, ST 64%, $3,42, um Guerreiro nível 4) numa cena fixa e **ignora a sessão real e não salva nada**. Útil para prints e para um primeiro contato. Deixe em `off` no uso real.

Não precisa reiniciar para trocar de cena: digite `/guild bug` (ou qualquer outra cena) e a banda muda na hora; `/guild off` volta à sessão real. O comando vale só para a sessão atual.

## Capturas da barra inferior

<table>
  <tr>
    <td align="center"><img src="docs/screenshots/explorador.png" alt="Explorador"><br>Explorador</td>
    <td align="center"><img src="docs/screenshots/mago.png" alt="Mago"><br>Mago</td>
    <td align="center"><img src="docs/screenshots/guerreiro.png" alt="Guerreiro"><br>Guerreiro</td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/bug.png" alt="Bug"><br>Bug</td>
    <td align="center"><img src="docs/screenshots/cansado.png" alt="Cansado"><br>Cansado</td>
    <td align="center"><img src="docs/screenshots/dormindo.png" alt="Dormindo"><br>Dormindo</td>
  </tr>
</table>


## Desenvolvimento

Para conferir uma mudança, rode o comando único que o CI também roda (`npm ci` uma vez para instalar o TypeScript fixado):

```sh
scripts/verify             # tipos, testes e validação do plugin; para na primeira falha
```

Os passos, um a um:

```sh
claude plugin test .       # testes unitários dos módulos puros e do que a banda e o painel mostram
claude plugin validate .   # checagem do manifesto e dos hooks
tsc -p .                   # checagem de tipos (veja abaixo)
node scripts/build-sprites.mjs   # reconstrói hooks/sprites.generated.ts a partir de art/
```

- `.claude-plugin/types/` guarda as declarações de tipos do Claude Code, que o engine grava ali ao carregar o plugin como mod. Está no `.gitignore`; o `tsc -p .` precisa dela, então o `scripts/verify` para com uma mensagem quando ela falta (o CI define `VERIFY_SKIP_TYPES=1` e pula a checagem de tipos).
- `scripts/engine-check` roda uma sessão curta de `claude -p` com o plugin instalado e confere se os hooks gravaram o registro. Precisa de um Claude Code logado, então é para a máquina de quem desenvolve, não para o CI.
- Toda a lógica está em módulos puros pequenos e testados: `classify.ts` (quem está em cena), `guild.ts` (estados de animação e o bug), `xp.ts` (XP e níveis), `tracker.ts` (tudo o que a guilda lembra), `view.ts` (o que a banda mostra), `layout.ts`, `raster.ts` (sprite → células de meio-bloco), `demo.ts`. Só `register.tsx` e `render.tsx` falam com o engine.
- O mod roda sem Node nem DOM, então não decodifica PNG. O `scripts/build-sprites.mjs` lê a exportação do Aseprite em `art/` e grava os quadros como dados (`hooks/sprites.generated.ts`), com uma versão em meio tamanho de cada um para os personagens pequenos.
- A arte foi feita no Aseprite (quadros de 32×32, uma paleta compartilhada de 21 cores).

## Roadmap

- Uma linha de status curta para quando a banda estiver escondida.

## Licença

[MIT](LICENSE), código e arte. Sem afiliação, endosso ou patrocínio da Anthropic.
