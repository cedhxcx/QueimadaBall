# QueimadaBall

Jogo de queimada multiplayer para navegador, inspirado no visual e na física leve do HaxBall.

## Jogar

1. Abra o link hospedado pelo GitHub Pages.
2. Digite seu nome e clique em **Criar sala**.
3. Copie o convite ou envie o código da sala aos amigos.
4. No lobby, o anfitrião organiza os times, adiciona/remove bots e inicia a partida. Até 12 participantes podem jogar.

## Controles

- **WASD** ou **setas:** mover
- **Mouse:** mirar
- **Segurar o clique:** carregar o arremesso
- **Soltar:** lançar
- **SHIFT** ou **E:** ativar a defesa por 3 segundos; depois, um cooldown de 3 segundos só diminui enquanto um adversário segura a bola. A mira fica visível apenas para quem está mirando.
- O anfitrião pode reiniciar a partida para voltar ao lobby, reorganizar os times e ajustar os bots.
- Se a bola ficar sem dono no cemitério por 1,8 segundo, ela retorna lentamente até a quadra.
- Ao ser queimado, o personagem se desintegra por 5 segundos antes de aparecer no cemitério e não pode voltar à partida
- Controles móveis: joystick + botões **DEFENDER** e **ARREMESSAR**

## Hospedagem no GitHub Pages

Depois de publicar na branch `main`:

1. Abra **Settings** > **Pages** no repositório.
2. Em **Build and deployment**, escolha **Deploy from a branch**.
3. Selecione `main` e a pasta `/ (root)`.
4. O jogo ficará disponível em `https://cedhxcx.github.io/QueimadaBall/`.

O multiplayer usa PeerJS WebRTC. O navegador do anfitrião mantém o estado da partida e não exige servidor próprio, contas ou credenciais no projeto.
