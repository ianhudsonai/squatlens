import type { CueMessages } from './types';

export const ptBR: CueMessages = {
  decimal: ',',
  cues: {
    'quality.no_pose': 'Nenhuma pessoa detectada no vídeo: filme o corpo inteiro, com boa luz.',
    'quality.low_visibility':
      'Iluminação ou enquadramento ruim: refaça o vídeo com o corpo todo visível e boa luz.',
    'quality.low_fps':
      'Poucos quadros úteis por segundo: filme com mais luz ou com uma taxa de quadros maior.',
    'quality.cut_off':
      'Parte do corpo saiu do quadro: afaste a câmera para pegar da cabeça aos pés.',
    'quality.tilted_camera':
      'A câmera parece inclinada: deixe o celular reto para medir melhor o tronco.',
    'view.diagonal': 'Câmera na diagonal: filme de lado (profundidade) ou de frente (joelhos).',
    'view.unknown':
      'Não deu para identificar o ângulo da câmera: filme de lado (profundidade) ou de frente (joelhos).',
    'nodata.reps': 'Nenhuma repetição completa detectada.',
    'nodata.depth': 'Sem dados suficientes para profundidade.',
    'nodata.trunk': 'Sem dados suficientes para o tronco.',
    'nodata.tempo': 'Sem dados suficientes para o ritmo.',
    'nodata.valgus': 'Sem dados suficientes para os joelhos.',
    'nodata.asymmetry': 'Sem dados suficientes para assimetria.',
    'depth.below': 'Boa profundidade: o quadril passou da linha do joelho.',
    'depth.parallel': 'Na linha do paralelo.',
    'depth.borderline': 'Perto do limite do paralelo, difícil cravar pela câmera.',
    'depth.above': 'Quase lá: desça mais um pouco.',
    'trunk.forward': 'Tronco bem mais inclinado que a canela: tente abrir o peito.',
    'valgus.flag':
      'Seus joelhos tenderam a entrar (confiança {conf}): pense em empurrar o chão para fora.',
    'asym.shift': 'O quadril desviou para a {side} no fundo.',
    'asym.uneven': 'Os dois lados ficaram desiguais no fundo: um lado desceu mais que o outro.',
    'tempo.fast_descent': 'Descida rápida: tente controlar mais.',
    'tempo.summary': 'Descida em {d} s e subida em {a} s.',
    'fatigue.loss': 'A velocidade de subida caiu {pct}% da primeira para a última rep.',
  },
  values: {
    conf: { low: 'baixa', medium: 'média', high: 'alta' },
    side: { left: 'esquerda', right: 'direita' },
  },
};
