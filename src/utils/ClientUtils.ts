import type { Buffer } from 'node:buffer';
// @ts-ignore
declare var global: any;
import IClient from '../client/IClient';
import IBot from '../bot/IBot';

export namespace ClientUtils {
  /** Gera um id único */
  export function generateId(): string {
    return `${process.pid}-${Date.now()}-${Object.keys(ClientUtils.getClients()).length}`;
  }

  /**
   * Retorna a lista de clientes diponíveis.
   * @returns Clientes ordenados pelo ID.
   */
  export function getClients(): Record<string, IClient<IBot>> {
    if (
      !('trompot-clients' in global) ||
      typeof global['trompot-clients'] != 'object'
    ) {
      global['trompot-clients'] = {};
    }

    return global['trompot-clients'];
  }

  /**
   * Define todos os clientes diponíveis.
   * @param clients - Clientes que serão definidios.
   */
  export function saveClients(clients: Record<string, IClient<IBot>>): void {
    global['trompot-clients'] = clients;
  }

  /**
   * Retorna o cliente pelo seu respectivo ID.
   * @param id - ID do cliente.
   * @returns O cliente associado ao ID.
   */
  export function getClient(id: string): IClient<IBot> {
    const clients = ClientUtils.getClients();

    if (id in clients && typeof clients[id] == 'object') {
      return clients[id];
    }

    if (
      global['default-trompot-worker'] ||
      global['trompot-cluster-save']?.worker
    ) {
      return ClientUtils.getClient(id);
    }

    throw new Error(`Client "${id}" not exists`);
  }

  /**
   * Define um cliente disponível
   * @param client - Cliente que será definido
   */
  export function saveClient(client: IClient<IBot>): void {
    if (
      !('trompot-clients' in global) ||
      typeof global['trompot-clients'] != 'object'
    ) {
      global['rompot-clients'] = {};
    }

    global['rompot-clients'][client.id] = client;
  }
}
