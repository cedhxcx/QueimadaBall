# QueimadaBall

Jogo de queimada multiplayer para navegador, inspirado no visual e na física leve do HaxBall.

## Jogar

1. Abra o link hospedado pelo GitHub Pages.
2. Digite seu nome e clique em **Criar sala**.
3. Copie o convite ou envie o código da sala aos amigos.
4. Até 12 pessoas podem entrar por conexão Peer-to-Peer.

## Controles

- **WASD** ou **setas:** mover
- **Mouse:** mirar
- **Segurar o clique:** carregar o arremesso
- **Soltar:** lançar
- **SHIFT** ou **E:** ativar a defesa por 3 segundos quando estiver pronta; o cooldown de 5 segundos só começa ao defender uma bola segurada pelo time adversário (alcance limitado a 2 raios do personagem; cooldown de 5 segundos)
- Ao ser queimado, o personagem se desintegra por 5 segundos antes de aparecer no cemitério e não pode voltar à partida
- Controles móveis: joystick + botões **DEFENDER** e **ARREMESSAR**

## Hospedagem no GitHub Pages

Depois de publicar na branch `main`:

1. Abra **Settings** > **Pages** no repositório.
2. Em **Build and deployment**, escolha **Deploy from a branch**.
3. Selecione `main` e a pasta `/ (root)`.
4. O jogo ficará disponível em `https://cedhxcx.github.io/QueimadaBall/`.

O multiplayer usa PeerJS WebRTC. O navegador do anfitrião mantém o estado da partida e não exige servidor próprio, contas ou credenciais no projeto.
