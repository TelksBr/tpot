import type KeyedDB from '@adiwajshing/keyed-db';

import NodeCache from 'node-cache';
import { Logger } from 'pino';

import {
  jidNormalizedUser,
  type BaileysEventEmitter,
  type Chat,
  type ConnectionState,
  type Contact,
  type GroupMetadata,
  type PresenceData,
  toNumber,
  WAMessage,
  WAMessageCursor,
  WASocket,
  WAMessageKey,
  proto,
  // makeInMemoryStore removido!
} from '@whiskeysockets/baileys';

// Mocks locais para tipos/funções do Baileys removidos
export type Comparable<T, K> = (a: T, b: T) => number;
export type Label = {
  id: string;
  name: string;
  predefinedId?: string;
  color?: number;
  deleted?: boolean;
};
export type LabelAssociation = any;
// Tipo correto para uso no KeyedDB
export type LabelAssociationKeyType = ((a: any, b: any) => number) & { key: (la: any) => string };

export class ObjectRepository<T> {
  constructor(_data?: any) {}
  upsertById(id: string, label: T) {}
}
export const waChatKey = (_: boolean) => (a: any, b: any) => 0;
// Mock corrigido para garantir compatibilidade
export const waLabelAssociationKey: LabelAssociationKeyType = Object.assign(
  (a: any, b: any) => 0,
  {
    key: (la: any) => la?.id || '',
  }
);
export const waMessageID = (msg: any) => msg?.id || '';

// Os utilitários abaixo não estão mais disponíveis publicamente no Baileys:
// import { waChatKey, waLabelAssociationKey, waMessageID } from '@whiskeysockets/baileys/lib/Store/make-in-memory-store';
// import { ObjectRepository } from '@whiskeysockets/baileys/lib/Store/object-repository';
// import { LabelAssociation } from '@whiskeysockets/baileys/lib/Types/LabelAssociation';
// import { Label } from '@whiskeysockets/baileys/lib/Types/Label';
// import { Comparable } from '@adiwajshing/keyed-db/lib/Types';
// Será necessário reimplementar ou adaptar essas funções/tipos localmente!

export type BaileysInMemoryStoreConfig = {
  chatKey?: Comparable<Chat, string>;
  labelAssociationKey?: LabelAssociationKeyType;
  logger?: Logger;
  stdTTL?: number;
};

const predefinedLabels = Object.freeze<Record<string, Label>>({
  '1': {
    id: '1',
    name: 'New customer',
    predefinedId: '1',
    color: 1,
    deleted: false,
  },
  '2': {
    id: '2',
    name: 'New order',
    predefinedId: '2',
    color: 2,
    deleted: false,
  },
  '3': {
    id: '3',
    name: 'Pending payment',
    predefinedId: '3',
    color: 3,
    deleted: false,
  },
  '4': {
    id: '4',
    name: 'Paid',
    predefinedId: '4',
    color: 4,
    deleted: false,
  },
  '5': {
    id: '5',
    name: 'Order completed',
    predefinedId: '5',
    color: 5,
    deleted: false,
  },
});

export function makeOrderedDictionary<T>(
  idGetter: (item: T) => string,
  stdTTL?: number,
) {
  const dictCache = new NodeCache({ stdTTL: stdTTL || 60 * 60 });

  const get = (id: string): T | undefined => dictCache.get(id) as T | undefined;

  const update = (item: T) => {
    const id = idGetter(item);
    const array: T[] = dictCache.keys().map((k) => dictCache.get(k)) as T[];
    const idx = array.findIndex((i) => idGetter(i) === id);
    if (idx >= 0) {
      dictCache.set(id, item);

      return true;
    }

    return false;
  };

  const upsert = (item: T, mode: 'append' | 'prepend') => {
    try {
      const id = idGetter(item);
      if (get(id)) {
        update(item);
      } else {
        dictCache.set(id, JSON.parse(JSON.stringify(item || {}) || '{}'));
      }
    } catch {}
  };

  const remove = (item: T) => {
    const id = idGetter(item);
    const array: T[] = dictCache.keys().map((k) => dictCache.get(k)) as T[];
    const idx = array.findIndex((i) => idGetter(i) === id);
    if (idx >= 0) {
      array.splice(idx, 1);
      dictCache.del(id);
      return true;
    }

    return false;
  };

  const array = dictCache.keys().map((k) => dictCache.get(k)) as T[];

  return {
    array,
    dictCache,
    get,
    upsert,
    update,
    remove,
    updateAssign: (id: string, update: Partial<T>) => {
      const item = get(id);
      if (item) {
        Object.assign(item, update);
        dictCache.del(id);
        dictCache.set(idGetter(item), item);
        return true;
      }

      return false;
    },
    clear: () => {
      dictCache.flushAll();
    },
    filter: (contain: (item: T) => boolean) => {
      const array: T[] = dictCache.keys().map((k) => dictCache.get(k)) as T[];

      let i = 0;
      while (i < array.length) {
        if (!contain(array[i])) {
          const id = idGetter(array[i]);
          dictCache.del(id);
          array.splice(i, 1);
        } else {
          i += 1;
        }
      }
    },
    toJSON: () => dictCache.keys().map((k) => dictCache.get<T>(k) as T),
    fromJSON: (newItems: T[]) => {
      const array = dictCache.keys().map((k) => dictCache.get(k));
      array.splice(0, array.length, ...newItems);
      dictCache.flushAll();
      newItems.forEach((item) => {
        const id = idGetter(item);
        dictCache.set(id, item);
      });
    },
  };
}

const makeMessagesDictionary = (stdTTL?: number) =>
  makeOrderedDictionary(waMessageID, stdTTL);

export default ({
  logger: _logger,
  chatKey,
  labelAssociationKey,
  stdTTL,
}: BaileysInMemoryStoreConfig): any => {
  chatKey = chatKey || waChatKey(true);
  labelAssociationKey = labelAssociationKey || waLabelAssociationKey;
  stdTTL = stdTTL || 60 * 60;
  const logger = _logger;
  const KeyedDB = require('@adiwajshing/keyed-db').default;

  const chats = new KeyedDB(chatKey, (c: any) => c.id) as KeyedDB<Chat, string>;
  const messages: { [_: string]: ReturnType<typeof makeMessagesDictionary> } =
    {};
  const contacts: { [_: string]: Contact } = {};
  const groupMetadata: { [_: string]: GroupMetadata } = {};
  const presences: { [id: string]: { [participant: string]: PresenceData } } =
    {};
  const state: ConnectionState = { connection: 'close' };
  const labels = new ObjectRepository<Label>(predefinedLabels);
  const labelAssociations = new KeyedDB(
    labelAssociationKey,
    labelAssociationKey.key,
  ) as KeyedDB<LabelAssociation, string>;

  const assertMessageList = (jid: string) => {
    if (!messages[jid]) {
      messages[jid] = makeMessagesDictionary(stdTTL);
    }

    return messages[jid];
  };

  const contactsUpsert = (newContacts: Contact[]) => {
    const oldContacts = new Set(Object.keys(contacts));
    for (const contact of newContacts) {
      oldContacts.delete(contact.id);
      contacts[contact.id] = Object.assign(contacts[contact.id] || {}, contact);
    }

    return oldContacts;
  };

  const labelsUpsert = (newLabels: Label[]) => {
    for (const label of newLabels) {
      labels.upsertById(label.id, label);
    }
  };

  /**
   * binds to a BaileysEventEmitter.
   * It listens to all events and constructs a state that you can query accurate data from.
   * Eg. can use the store to fetch chats, contacts, messages etc.
   * @param ev typically the event emitter from the socket connection
   */
  const bind = (ev: BaileysEventEmitter) => {
    ev.on('connection.update', (update) => {
      Object.assign(state, update);
    });

    ev.on(
      'messaging-history.set',
      ({
        chats: newChats,
        contacts: newContacts,
        messages: newMessages,
        isLatest,
      }) => {
        try {
          if (isLatest) {
            chats.clear();

            for (const id in messages) {
              delete messages[id];
            }
          }

          for (const msg of newMessages) {
            const jid = msg.key.remoteJid!;
            const list = assertMessageList(jid);
            list.upsert(msg, 'prepend');
          }

          logger?.debug({ messages: newMessages.length }, 'synced messages');
        } catch {}
      },
    );

    ev.on('messages.upsert', ({ messages: newMessages, type }) => {
      try {
        switch (type) {
          case 'append':
          case 'notify':
            for (const msg of newMessages) {
              const jid = jidNormalizedUser(msg.key.remoteJid!);
              const list = assertMessageList(jid);
              list.upsert(msg, 'append');

              if (type === 'notify') {
                if (!chats.get(jid)) {
                  ev.emit('chats.upsert', [
                    {
                      id: jid,
                      conversationTimestamp: toNumber(msg.messageTimestamp),
                      unreadCount: 1,
                    },
                  ]);
                }
              }
            }

            break;
        }
      } catch {}
    });
    ev.on('messages.update', (updates) => {
      try {
        for (const { update, key } of updates) {
          const list = assertMessageList(jidNormalizedUser(key.remoteJid!));
          if (update?.status) {
            const listStatus = list.get(key.id!)?.status;
            if (listStatus && update?.status <= listStatus) {
              logger?.debug(
                { update, storedStatus: listStatus },
                'status stored newer then update',
              );
              delete update.status;
              logger?.debug({ update }, 'new update object');
            }
          }

          const result = list.updateAssign(key.id!, update);
          if (!result) {
            logger?.debug({ update }, 'got update for non-existent message');
          }
        }
      } catch {}
    });
    ev.on('messages.delete', (item) => {
      try {
        if ('all' in item) {
          const list = messages[item.jid];
          list?.clear();
        } else {
          const jid = item.keys[0].remoteJid!;
          const list = messages[jid];
          if (list) {
            const idSet = new Set(item.keys.map((k) => k.id));
            list.filter((m) => !idSet.has(m.key.id));
          }
        }
      } catch {}
    });
  };

  const toJSON = () => ({
    chats,
    contacts,
    messages,
    labels,
    labelAssociations,
  });

  const fromJSON = (json: {
    chats: Chat[];
    contacts: { [id: string]: Contact };
    messages: { [id: string]: WAMessage[] };
    labels: { [labelId: string]: Label };
    labelAssociations: LabelAssociation[];
  }) => {
    chats.upsert(...json.chats);
    labelAssociations.upsert(...(json.labelAssociations || []));
    contactsUpsert(Object.values(json.contacts));
    labelsUpsert(Object.values(json.labels || {}));
    for (const jid in json.messages) {
      const list = assertMessageList(jid);
      for (const msg of json.messages[jid]) {
        list.upsert(msg, 'append');
      }
    }
  };

  return {
    chats,
    contacts,
    messages,
    groupMetadata,
    state,
    presences,
    labels,
    labelAssociations,
    bind,
    /** loads messages from the store, if not found -- uses the legacy connection */
    loadMessages: async (
      jid: string,
      count: number,
      cursor: WAMessageCursor,
    ) => {
      const list = assertMessageList(jid);
      const mode = !cursor || 'before' in cursor ? 'before' : 'after';
      const cursorKey = cursor
        ? 'before' in cursor
          ? cursor.before
          : cursor.after
        : undefined;
      const cursorValue = cursorKey ? list.get(cursorKey.id!) : undefined;

      let messages: WAMessage[];
      if (list && mode === 'before' && (!cursorKey || cursorValue)) {
        if (cursorKey && cursorValue) {
          // NodeCache.mget retorna um objeto, precisamos extrair os valores
          messages = Object.values(list.dictCache.mget([cursorKey.id!]));
        } else {
          messages = Object.values(list.dictCache.mget(list.dictCache.keys()));
        }
      } else {
        // Fallback removido: não há ev.connection disponível nesse escopo
        messages = [];
      }

      return messages as WAMessage[];
    },
    /** returns the latest message in the chat */
    getLatestMessage: (jid: string) => {
      const list = assertMessageList(jid);
      const array = list.toJSON();
      if (array.length > 0) {
        return array[array.length - 1];
      }

      return undefined;
    },
    /** returns an array of all messages in a chat */
    getMessages: (jid: string) => {
      const list = assertMessageList(jid);
      return list.toJSON();
    },
    /** returns the chat object, with the latest message populated */
    getChat: (jid: string) => {
      const chat = chats.get(jid);
      if (chat) {
        const message = (this as any).getLatestMessage(jid);
        if (message) {
          chat.conversationTimestamp = toNumber(message.messageTimestamp);
        }
      }

      return chat;
    },
    /** returns an array of all chats, with the latest message populated */
    getAllChats: () => {
      const array = chats.toJSON();
      for (const chat of array) {
        const message = (this as any).getLatestMessage(chat.id);
        if (message) {
          chat.conversationTimestamp = toNumber(message.messageTimestamp);
        }
      }

      return array;
    },
    /** returns an array of all contacts */
    getAllContacts: () => {
      return Object.values(contacts);
    },
    /** returns an array of all groups */
    getAllGroups: () => {
      return Object.values(groupMetadata);
    },
    /** returns the metadata of a group, or undefined if not a group chat */
    getGroupMetadata: (jid: string) => {
      return groupMetadata[jid];
    },
    /** returns the presence data of a participant in a group, or undefined if not a group chat */
    getGroupParticipantPresence: (jid: string, participantId: string) => {
      return presences[jid]?.[participantId];
    },
    /** returns the connection state */
    getConnectionState: () => {
      return state;
    },
    /** returns the logger */
    getLogger: () => {
      return logger;
    },
    /** returns the label repository */
    getLabelRepository: () => {
      return labels;
    },
    /** returns the label association store */
    getLabelAssociationStore: () => {
      return labelAssociations;
    },
    /** returns the message store for a specific chat */
    getMessageStore: (jid: string) => {
      return assertMessageList(jid);
    },
    /** clears all data in the store */
    clearAll: () => {
      chats.clear();
      for (const id in messages) {
        delete messages[id];
      }
      contactsUpsert(Object.values(predefinedLabels));
    },
    /** imports data into the store */
    importData: (data: {
      chats?: Chat[];
      contacts?: Contact[];
      messages?: { [id: string]: WAMessage[] };
      labels?: Label[];
      labelAssociations?: LabelAssociation[];
    }) => {
      if (data.chats) {
        chats.upsert(...data.chats);
      }
      if (data.contacts) {
        contactsUpsert(data.contacts);
      }
      if (data.messages) {
        for (const jid in data.messages) {
          const list = assertMessageList(jid);
          for (const msg of data.messages[jid]) {
            list.upsert(msg, 'append');
          }
        }
      }
      if (data.labels) {
        labelsUpsert(data.labels);
      }
      if (data.labelAssociations) {
        labelAssociations.upsert(...data.labelAssociations);
      }
    },
  };
};
