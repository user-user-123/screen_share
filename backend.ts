import { OnModuleInit } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

function generateShortUUID(): string {
  return uuidv4().substring(0, 5);
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class MyGateway implements OnModuleInit {
  @WebSocketServer()
  server: Server;

  private screenShareCodes = new Map<string, string>();
  private peerConnections = new Map<string, Set<string>>();

  onModuleInit() {
    this.server.on('connection', (socket) => {
      console.log(`${socket.id} connected`);

      socket.on('disconnect', () => {
        this.screenShareCodes.forEach((value, key) => {
          if (value === socket.id) {
            this.screenShareCodes.delete(key);
          }
        });
        this.peerConnections.delete(socket.id);
        console.log(`${socket.id} disconnected`);
      });
    });
  }

  @SubscribeMessage('startScreenShare')
  handleStartScreenShare(@ConnectedSocket() socket: Socket) {
    const code = generateShortUUID();
    this.screenShareCodes.set(code, socket.id);
    this.peerConnections.set(socket.id, new Set());

    socket.emit('sessionCode', code);
  }

  @SubscribeMessage('joinSession')
  handleJoinSession(@MessageBody() { code }: { code: string }, @ConnectedSocket() socket: Socket) {
    const hostSocketId = this.screenShareCodes.get(code);
    if (hostSocketId) {
      socket.emit('joinSuccess');
      this.peerConnections.get(hostSocketId).add(socket.id);

      this.server.to(hostSocketId).emit('getOffer', { newClient: socket.id });
    } else {
      socket.emit('joinFailure');
    }
  }

  @SubscribeMessage('newOffer')
  handleOffer(@MessageBody() { offer, socketId }: { offer: any, socketId: string }, @ConnectedSocket() socket: Socket) {
    socket.to(socketId).emit('onOffer', { offer, socketId: socket.id });
  }

  @SubscribeMessage('newAnswer')
  handleAnswer(@MessageBody() { answer, socketId }: { answer: any, socketId: string }, @ConnectedSocket() socket: Socket) {
    socket.to(socketId).emit('onAnswer', { answer, socketId: socket.id });
  }

  @SubscribeMessage('newIceCandidate')
  handleIceCandidate(@MessageBody() { candidate, socketId }: { candidate: any, socketId: string }, @ConnectedSocket() socket: Socket) {
    socket.to(socketId).emit('onIceCandidate', { candidate, socketId: socket.id });
  }

  @SubscribeMessage('screenShareStopped')
  handleScreenShareStopped(@ConnectedSocket() socket: Socket) {
    const clients = this.peerConnections.get(socket.id) || new Set();
    clients.forEach(clientId => {
      this.server.to(clientId).emit('screenShareEnded');
    });
  }
}