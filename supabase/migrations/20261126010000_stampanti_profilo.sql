-- Impostazioni stampanti: set di caratteri ESC/POS e modello riconosciuto dalla ricerca in rete.
alter table public.stampanti
  add column if not exists codepage smallint not null default 19 check (codepage between 0 and 255),
  add column if not exists modello text;
comment on column public.stampanti.codepage is 'ESC t n: 19 = PC858 (con €), 2 = PC850, 16 = Windows-1252, 0 = PC437';
comment on column public.stampanti.modello is 'Marca e modello riconosciuti dalla ricerca in rete (es. EPSON TM-T20III)';
