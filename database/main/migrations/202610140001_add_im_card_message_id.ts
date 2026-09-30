import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Real Feishu bot (V1-04): `imCards.externalMessageId` is the id Feishu gave
 * the message that carries a card, which updating the card in place needs.
 * The development mock never sets it.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610140001_add_im_card_message_id',
  async up({ builder }) {
    await builder.alterCollection('imCards', (c) => {
      c.string('externalMessageId', { length: 128 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('imCards', (c) => {
      c.dropFields('externalMessageId');
    });
  },
});

export default migration;
