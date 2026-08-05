export function setupSocket(io) {
  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    // Peserta join room berdasarkan nomor antrian untuk terima update
    socket.on('peserta:join', (nomorAntrian) => {
      socket.join(`peserta:${nomorAntrian}`);
      console.log(`Peserta ${nomorAntrian} joined room`);
    });

    // Panitia join room panitia
    socket.on('panitia:join', () => {
      socket.join('panitia');
      console.log('Panitia joined room');
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  return io;
}
